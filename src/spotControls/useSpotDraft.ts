import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createSpot,
  deleteSpot,
  MAP_SKETCH_COLUMN,
  updateSpot,
  type SpotPatch,
  type SpotRecord,
} from '../api/spots';
import { currentUserAtom } from '../auth/atoms';
import { bboxWidthMetres } from '../map/bbox';
import { mosaicTiles } from '../map/grid';
import { suggestPlaceName } from '../search/placeNames';
import { drawHoldAtom } from '../shared/uiContext';
import { sketchShownAtom } from '../sketch/overlay';
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

const SUGGEST_SETTLE_MS = 500;

export type SpotStep = 'pin' | 'description' | 'sketch' | 'footprint' | null;

export type SpotWriteError = 'save' | 'delete' | null;

export type SpotDraftController = {
  draft: SpotDraft;
  record: SpotRecord | null;
  isNew: boolean;
  step: SpotStep;
  name: string;
  description: string;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  suggesting: boolean;
  textDirty: boolean;
  canSaveText: boolean;
  saveText: () => void;
  revertText: () => void;
  stage: SpotDraft['stage'];
  setStage: (stage: SpotDraft['stage']) => void;
  footprintSideMetres: number | null;
  footprintTiles: number;
  footprintClamped: 'min' | 'max' | null;
  hasSketch: boolean;
  busy: boolean;
  deleting: boolean;
  error: SpotWriteError;
  sketchTooBig: boolean;
  remove: () => void;
  close: () => void;
  finish: () => void;
};

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

  const nameTouched = useRef(saved != null);

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

  const creating = useRef(saved != null);
  useEffect(() => {
    if (creating.current || !user) return;
    const open = store.get(spotDraftAtom);
    if (!open) return;
    creating.current = true;
    const name = store.get(spotFormAtom).name.trim() || formatPoint(open.point);

    enqueue(async () => {
      try {
        const made = await createSpot({ name, point: open.point }, user.id);
        setRecord(made);
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

  const [lon, lat] = draft.point;
  useEffect(() => {
    if (nameTouched.current) return;
    let live = true;
    setSuggesting(true);

    const timer = setTimeout(() => {
      void suggestPlaceName(lon, lat, 'EPSG:4326').then((suggestion) => {
        if (!live) return;
        setSuggesting(false);
        if (!suggestion || nameTouched.current) return;
        setForm((current) => ({ ...current, name: suggestion }));
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

    if (stage === 'sketch') {
      const drawing = sketchNow(drawn);
      if (drawing || current.sketch) {
        if (sketchBytes(drawing) > SKETCH_BUDGET_BYTES) setSketchTooBig(true);
        else {
          setSketchTooBig(false);
          fields.sketch = drawing;
          fields.mapSketch = drawing ? MAP_SKETCH_COLUMN : '';
          kept = drawing;
          if (drawing) store.set(sketchShownAtom, true);
        }
      }
      if (store.get(spotDraftAtom)) store.set(spotSketchAtom, drawing);
    }

    if (rect == null && current.footprint == null) {
      const derived = derivedFootprint(point, kept);
      fields.footprint = derived.bbox;
      setFootprintClamped(derived.clamped);
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

  useEffect(
    () => () => {
      if (left.current || store.get(spotDraftAtom)) return;
      commit();
      void chain.current.then(setActive);
    },
    [commit, store, setActive],
  );

  const drawing = draft.stage === 'sketch';
  const fromCard = draft.box === 'card';
  const setDrawHold = useSetAtom(drawHoldAtom);
  useEffect(() => {
    if (!drawing) return;
    setDrawHold({
      name: form.name.trim() || record?.name || '',
      save: fromCard ? finish : saveSketch,
      abort: fromCard ? abort : cancelSketch,
    });
    return () => setDrawHold(null);
  }, [
    drawing,
    fromCard,
    form.name,
    record?.name,
    finish,
    abort,
    saveSketch,
    cancelSketch,
    setDrawHold,
  ]);

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
    footprintSideMetres: footprint
      ? Math.round(bboxWidthMetres(footprint))
      : null,
    footprintTiles: footprint ? mosaicTiles(footprint).length : 1,
    footprintClamped,
    hasSketch: (sketch?.elements.length ?? 0) > 0,
    busy: writes > 0,
    deleting,
    error,
    sketchTooBig,
    remove,
    close: closeDraft,
    finish,
  };
};
