// A spot is written as it is made, not at the end: the record is created the
// moment the pin lands and every unit of the box after that — the point, the
// typed text, the drawing, the rectangle — is a write of its own. So there is
// no save button over the whole box, and closing it throws nothing away.

import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createSpot,
  deleteSpot,
  updateSpot,
  type SpotPatch,
  type SpotRecord,
} from '../api/spots';
import { currentUserAtom } from '../auth/atoms';
import { bboxWidthMetres } from '../map/bbox';
import { SKETCH_BUDGET_BYTES, sketchBytes, sketchOf } from '../sketch/scene';
import { sketchNow } from '../sketch/session';
import {
  activeSpotAtom,
  closeSpotDraftAtom,
  setSpotStageAtom,
  spotDraftAtom,
  spotFootprintAtom,
  spotFormAtom,
  spotSketchAtom,
  type SpotDraft,
} from '../spots/atoms';
import { derivedFootprint } from '../spots/footprint';
import { formatPoint } from '../spots/geo';
import { suggestSpotName } from '../spots/spotName';

/** How long the pin stands still before the name register is asked. */
const SUGGEST_SETTLE_MS = 500;

/** Which unit of the box wears the accent: whatever has hold of the map, and
 *  failing that the first thing the record is still missing. */
export type SpotStep = 'pin' | 'description' | 'sketch' | 'footprint' | null;

export type SpotWriteError = 'save' | 'delete' | null;

export type SpotDraftController = {
  draft: SpotDraft;
  /** The record behind the box. Null only until the create lands, and for good
   *  if it failed. */
  record: SpotRecord | null;
  /** The box was opened on a pin, not on a spot that already existed. */
  isNew: boolean;
  step: SpotStep;
  name: string;
  description: string;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  /** A lookup is in flight and the name field may still fill itself in. */
  suggesting: boolean;
  /** What is typed differs from what is stored. */
  textDirty: boolean;
  canSaveText: boolean;
  saveText: () => void;
  /** Back to what is in the database. */
  revertText: () => void;
  stage: SpotDraft['stage'];
  /** Leaving a stage writes what it changed. */
  setStage: (stage: SpotDraft['stage']) => void;
  /** Put the pen down and keep the strokes. */
  saveSketch: () => void;
  /** Put the pen down and go back to the stored drawing. */
  cancelSketch: () => void;
  footprintSideMetres: number | null;
  /** The drawing the rectangle was derived from was smaller than `MIN_SIDE_M`
   *  or larger than `MAX_SIDE_M`, so the square is not what was drawn. */
  footprintClamped: 'min' | 'max' | null;
  hasSketch: boolean;
  /** A write is in flight. */
  busy: boolean;
  deleting: boolean;
  error: SpotWriteError;
  /** The drawing is past the column's 5 MB cap; nothing was sent. */
  sketchTooBig: boolean;
  remove: () => void;
  close: () => void;
  /** Write what the stage in hand changed and let the draft go. The card closes
   *  itself from a button on the stage, so unlike the editor it cannot leave
   *  the write to the unmount, which cannot tell a kept drawing from a
   *  discarded one. */
  finish: () => void;
  /** Let the draft go and keep nothing the stage did. */
  abort: () => void;
};

// A PocketBase validation message names no field; the one at fault is only in
// `response.data`.
const warn = (what: string, err: unknown) =>
  console.warn(
    `[spots] ${what} failed`,
    err,
    (err as { response?: { data?: unknown } })?.response?.data,
  );

const sameNumbers = (
  a: readonly number[] | null,
  b: readonly number[] | null,
): boolean =>
  a === b ||
  (a != null &&
    b != null &&
    a.length === b.length &&
    a.every((value, i) => value === b[i]));

export const useSpotDraft = (
  draft: SpotDraft,
  /** The spot the box was opened on, or null for one being made. */
  saved: SpotRecord | null,
): SpotDraftController => {
  const user = useAtomValue(currentUserAtom);
  const store = useStore();
  const [form, setForm] = useAtom(spotFormAtom);
  const sketch = useAtomValue(spotSketchAtom);
  const footprint = useAtomValue(spotFootprintAtom);
  const stageTo = useSetAtom(setSpotStageAtom);
  const closeDraft = useSetAtom(closeSpotDraftAtom);
  const setActive = useSetAtom(activeSpotAtom);

  // The box is keyed on the draft, so all of these open once per draft.
  const [record, setRecord] = useState<SpotRecord | null>(saved);
  const [suggesting, setSuggesting] = useState(false);
  const [writes, setWrites] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<SpotWriteError>(null);
  const [sketchTooBig, setSketchTooBig] = useState(false);
  const [footprintClamped, setFootprintClamped] = useState<
    'min' | 'max' | null
  >(null);
  const [isNew] = useState(saved == null);

  /** Once the author has typed a name, the register never writes it again. */
  const nameTouched = useRef(saved != null);

  /**
   * Every write against the record, one at a time and in the order the reader
   * made them. Two PATCHes in flight together would leave whichever landed
   * second's copy of the spot on screen, and the create has to be first of all.
   */
  const chain = useRef<Promise<SpotRecord | null>>(Promise.resolve(saved));

  const enqueue = useCallback(
    (step: (current: SpotRecord | null) => Promise<SpotRecord | null>) => {
      chain.current = chain.current.then(async (current) => {
        setWrites((n) => n + 1);
        try {
          return await step(current);
        } finally {
          setWrites((n) => n - 1);
        }
      });
    },
    [],
  );

  const write = useCallback(
    (what: string, step: (current: SpotRecord) => Promise<SpotRecord>) =>
      enqueue(async (current) => {
        // No record to write against: the create failed, or the spot has since
        // been deleted.
        if (!current) return null;
        try {
          const next = await step(current);
          setRecord(next);
          setError(null);
          return next;
        } catch (err) {
          warn(what, err);
          setError('save');
          return current;
        }
      }),
    [enqueue],
  );

  const patch = useCallback(
    (fields: SpotPatch) =>
      write('update', (current) => updateSpot(current.id, fields)),
    [write],
  );

  // The record exists from the moment the pin lands, which is also what lets
  // the pictures hang off it while the rest is still being filled in.
  const creating = useRef(saved != null);
  useEffect(() => {
    if (creating.current || !user) return;
    const open = store.get(spotDraftAtom);
    if (!open) return;
    creating.current = true;
    // A name is required and the register has not answered yet, so the pin's
    // own coordinate stands in until it does.
    const name = store.get(spotFormAtom).name.trim() || formatPoint(open.point);

    enqueue(async () => {
      try {
        const made = await createSpot({ name, point: open.point }, user.id);
        setRecord(made);
        // Read back rather than closed over: the pin may have been dragged
        // while the create was in flight.
        const now = store.get(spotDraftAtom);
        if (now) store.set(spotDraftAtom, { ...now, recordId: made.id });
        return made;
      } catch (err) {
        warn('create', err);
        setError('save');
        return null;
      }
    });
  }, [user, store, enqueue]);

  const setName = useCallback(
    (name: string) => {
      nameTouched.current = true;
      setForm((current) => ({ ...current, name }));
    },
    [setForm],
  );

  const setDescription = useCallback(
    (description: string) =>
      setForm((current) => ({ ...current, description })),
    [setForm],
  );

  // Keyed on the coordinate, so this covers opening the draft and every drag.
  const [lon, lat] = draft.point;
  useEffect(() => {
    if (nameTouched.current) return;
    let live = true;
    setSuggesting(true);

    const timer = setTimeout(() => {
      // Degrees: the draft's point is EPSG:4326.
      void suggestSpotName(lon, lat, 'EPSG:4326').then((suggestion) => {
        if (!live) return;
        setSuggesting(false);
        if (!suggestion || nameTouched.current) return;
        setForm((current) => ({ ...current, name: suggestion }));
        // The record was created under the coordinate, so the register's answer
        // is a write of its own rather than something the reader must confirm.
        patch({ name: suggestion });
      });
    }, SUGGEST_SETTLE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
      setSuggesting(false);
    };
  }, [lon, lat, setForm, patch]);

  const typedName = form.name.trim();
  const textDirty =
    record != null &&
    (typedName !== record.name || form.description !== record.description);
  const canSaveText = textDirty && typedName.length > 0 && !deleting;

  const saveText = useCallback(() => {
    if (!canSaveText) return;
    patch({ name: typedName, description: form.description });
  }, [canSaveText, patch, typedName, form.description]);

  const revertText = useCallback(() => {
    if (!record) return;
    setForm({ name: record.name, description: record.description });
  }, [record, setForm]);

  /**
   * What the units on the map hold, as the last render saw it. Read through a
   * ref because the box can be closed from outside itself — the band's `+` —
   * and the leaving write is then made on the way out rather than by whoever
   * closed it.
   */
  const held = useRef({
    stage: draft.stage,
    point: draft.point,
    footprint,
    sketch,
    record,
  });
  useEffect(() => {
    held.current = {
      stage: draft.stage,
      point: draft.point,
      footprint,
      sketch,
      record,
    };
  });

  const commit = useCallback(() => {
    const {
      stage,
      point,
      footprint: rect,
      sketch: drawn,
      record: current,
    } = held.current;
    if (!current) return;
    const fields: SpotPatch = {};

    if (!sameNumbers(point, current.point)) fields.point = point;
    if (!sameNumbers(rect, current.footprint)) fields.footprint = rect;

    let kept = drawn;

    // Only off the stage that owns it: the drawing is compared by identity and
    // `sketchNow` builds a fresh object, so anything wider would resend five
    // megabytes on every press.
    if (stage === 'sketch') {
      // The live canvas, not the settled scene, so putting the pen down on the
      // tail of a stroke keeps that stroke.
      const drawing = sketchNow(drawn);
      if (drawing || current.sketch) {
        // Checked here so the 5 MB column cap is not a 400 after the work is
        // done.
        if (sketchBytes(drawing) > SKETCH_BUDGET_BYTES) setSketchTooBig(true);
        else {
          setSketchTooBig(false);
          fields.sketch = drawing;
          kept = drawing;
        }
      }
      // The canvas goes as soon as the stage is left and Excalidraw's scene
      // with it, so this is the only copy the row and the overlay have to read
      // afterwards. Not on the way out of the box, where the atoms are already
      // cleared and the draft is gone.
      if (store.get(spotDraftAtom)) store.set(spotSketchAtom, drawing);
    }

    // A spot always has a rectangle, and the reader is never asked for one: the
    // first write that finds the record without one gives it the square around
    // whatever has been drawn, or the default around the pin.
    if (rect == null && current.footprint == null) {
      const derived = derivedFootprint(point, kept);
      fields.footprint = derived.bbox;
      setFootprintClamped(derived.clamped);
      // So the box shows the square it just gave the spot, and asking to adjust
      // it grabs that one rather than seeding another.
      if (store.get(spotDraftAtom)) store.set(spotFootprintAtom, derived.bbox);
    }

    if (Object.keys(fields).length > 0) patch(fields);
  }, [patch, store]);

  const setStage = useCallback(
    (next: SpotDraft['stage']) => {
      if (next === held.current.stage) return;
      commit();
      stageTo(next);
    },
    [commit, stageTo],
  );

  const saveSketch = useCallback(() => setStage('idle'), [setStage]);

  const cancelSketch = useCallback(() => {
    setSketchTooBig(false);
    store.set(spotSketchAtom, held.current.record?.sketch ?? null);
    stageTo('idle');
  }, [store, stageTo]);

  /** Set by whoever closed the draft from inside the box, so the unmount below
   *  does not write a second time. */
  const left = useRef(false);

  const leave = useCallback(
    (keep: boolean) => {
      if (keep) commit();
      left.current = true;
      closeDraft();
      void chain.current.then(setActive);
    },
    [commit, closeDraft, setActive],
  );

  const finish = useCallback(() => leave(true), [leave]);
  const abort = useCallback(() => leave(false), [leave]);

  const remove = useCallback(() => {
    setDeleting(true);
    setError(null);
    chain.current = chain.current.then(async (current) => {
      if (!current) {
        closeDraft();
        return null;
      }
      try {
        await deleteSpot(current.id);
        setActive(null);
        closeDraft();
        return null;
      } catch (err) {
        warn('delete', err);
        setError('delete');
        setDeleting(false);
        return current;
      }
    });
  }, [closeDraft, setActive]);

  // The way out, whoever took it. Guarded on the draft actually being gone:
  // React's development double-invoke would otherwise fire this the moment the
  // box opened. A delete has already settled the chain on null, so the write
  // below is skipped and the card does not reopen on a spot that is not there.
  useEffect(
    () => () => {
      if (left.current || store.get(spotDraftAtom)) return;
      commit();
      void chain.current.then(setActive);
    },
    [commit, store, setActive],
  );

  const step: SpotStep =
    draft.stage !== 'idle'
      ? draft.stage
      : !record
        ? null
        : record.description.trim() === ''
          ? 'description'
          : sketchOf(record.sketch) === null
            ? 'sketch'
            : null;

  return {
    draft,
    record,
    isNew,
    step,
    name: form.name,
    description: form.description,
    setName,
    setDescription,
    suggesting,
    textDirty,
    canSaveText,
    saveText,
    revertText,
    stage: draft.stage,
    setStage,
    saveSketch,
    cancelSketch,
    footprintSideMetres: footprint
      ? Math.round(bboxWidthMetres(footprint))
      : null,
    footprintClamped,
    hasSketch: (sketch?.elements.length ?? 0) > 0,
    busy: writes > 0,
    deleting,
    error,
    sketchTooBig,
    remove,
    close: closeDraft,
    finish,
    abort,
  };
};
