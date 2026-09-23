import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createSpot, updateSpot, type SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';
import { SKETCH_BUDGET_BYTES, sketchBytes } from '../sketch/scene';
import { sketchNow } from '../sketch/session';
import {
  activeSpotAtom,
  closeSpotDraftAtom,
  setSpotStageAtom,
  spotFormAtom,
  spotSketchAtom,
  type SpotDraft,
} from '../spots/atoms';
import { suggestSpotName } from '../spots/spotName';

/** How long the pin stands still before the name register is asked. */
const SUGGEST_SETTLE_MS = 500;

export type SpotDraftController = {
  draft: SpotDraft;
  name: string;
  description: string;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  /** A lookup is in flight and the name field may still fill itself in. */
  suggesting: boolean;
  stage: SpotDraft['stage'];
  setStage: (stage: SpotDraft['stage']) => void;
  hasSketch: boolean;
  saving: boolean;
  saveError: boolean;
  /** The drawing is past the column's 5 MB cap; nothing was sent. */
  sketchTooBig: boolean;
  /** There is something in the box that closing it would throw away. */
  dirty: boolean;
  canSave: boolean;
  save: () => void;
  abort: () => void;
};

export const useSpotDraft = (draft: SpotDraft): SpotDraftController => {
  const user = useAtomValue(currentUserAtom);
  const [form, setForm] = useAtom(spotFormAtom);
  const sketch = useAtomValue(spotSketchAtom);
  const setStage = useSetAtom(setSpotStageAtom);
  const closeDraft = useSetAtom(closeSpotDraftAtom);
  const setActive = useSetAtom(activeSpotAtom);

  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [sketchTooBig, setSketchTooBig] = useState(false);

  /** Once the author has typed a name, the register never writes it again. */
  const nameTouched = useRef(draft.recordId != null);

  /** The baseline `dirty` is measured against. State rather than a ref because
   *  `dirty` is read while rendering. */
  const [opened, setOpened] = useState({
    name: form.name,
    description: form.description,
    sketch,
  });

  const setName = useCallback(
    (name: string) => {
      nameTouched.current = true;
      setForm((current) => ({ ...current, name }));
    },
    [setForm],
  );

  const setDescription = useCallback(
    (description: string) => setForm((current) => ({ ...current, description })),
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
        if (suggestion && !nameTouched.current) {
          setForm((current) => ({ ...current, name: suggestion }));
          // The register wrote it, not the reader, so move the baseline too.
          setOpened((current) => ({ ...current, name: suggestion }));
        }
      });
    }, SUGGEST_SETTLE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
      setSuggesting(false);
    };
  }, [lon, lat, setForm]);

  const name = form.name.trim();
  const canSave = user != null && name.length > 0 && !saving;

  // The drawing is compared by identity, so putting the pen down having changed
  // nothing still counts as dirty.
  const dirty =
    form.name !== opened.name ||
    form.description !== opened.description ||
    sketch !== opened.sketch;

  const save = useCallback(() => {
    if (!user || !name) return;

    // The live canvas, not the settled scene, so saving on the tail of a stroke
    // keeps that stroke.
    const drawing = sketchNow(sketch);
    // Checked here so the 5 MB column cap is not a 400 after the work is done.
    if (sketchBytes(drawing) > SKETCH_BUDGET_BYTES) {
      setSketchTooBig(true);
      return;
    }

    setSaving(true);
    setSaveError(false);
    setSketchTooBig(false);

    const body = {
      name,
      description: form.description,
      point: draft.point,
      sketch: drawing,
    };

    const written: Promise<SpotRecord> = draft.recordId
      ? updateSpot(draft.recordId, body)
      : createSpot(body, user.id);

    written
      .then((record) => {
        setActive(record);
        closeDraft();
      })
      .catch((err: unknown) => {
        // A PocketBase validation message names no field; the one at fault is
        // only in `response.data`.
        console.warn(
          '[spots] save failed',
          err,
          (err as { response?: { data?: unknown } })?.response?.data,
        );
        setSaving(false);
        setSaveError(true);
      });
  }, [
    user,
    name,
    form.description,
    draft.point,
    draft.recordId,
    sketch,
    setActive,
    closeDraft,
  ]);

  return {
    draft,
    name: form.name,
    description: form.description,
    setName,
    setDescription,
    suggesting,
    stage: draft.stage,
    setStage,
    hasSketch: (sketch?.elements.length ?? 0) > 0,
    saving,
    saveError,
    sketchTooBig,
    dirty,
    canSave,
    save,
    abort: closeDraft,
  };
};
