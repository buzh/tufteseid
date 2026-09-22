// The controller behind the box: everything a draft can do, and the name
// lookup that fills it in.
//
// Mounted by `SpotSurface` and by nothing else, so the churn of typing a
// description stays inside the box rather than re-rendering the map panes.

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createSpot, updateSpot, type SpotRecord } from '../api/spots';
import { currentUserAtom } from '../auth/atoms';
import {
  activeSpotAtom,
  closeSpotDraftAtom,
  setSpotStageAtom,
  spotFormAtom,
  spotSketchAtom,
  type SpotDraft,
} from '../spots/atoms';
import { suggestSpotName } from '../spots/spotName';

/**
 * How long the pin has to stand still before the register is asked what the
 * place is called. Long enough that dragging across a valley asks once rather
 * than at every frame, short enough that the field fills in while the reader is
 * still looking at the pin.
 */
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
  /** Something has been drawn. */
  hasSketch: boolean;
  saving: boolean;
  saveError: boolean;
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

  /**
   * Whether the author has had the field. Once they have, the register never
   * writes into it again — a suggestion that overwrote a typed name would lose
   * work every time the pin was nudged.
   */
  const nameTouched = useRef(draft.recordId != null);

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

  // Ask what the place is called, once the pin has stood still. Keyed on the
  // coordinate, so this covers both opening the draft and every drag after it.
  const [lon, lat] = draft.point;
  useEffect(() => {
    if (nameTouched.current) return;
    let live = true;
    setSuggesting(true);

    const timer = setTimeout(() => {
      // Asked in degrees — `ost`/`nord` with `koordsys=4326` — because that is
      // what the draft holds. The view's own projection would save a transform
      // the register does anyway.
      void suggestSpotName(lon, lat, 'EPSG:4326').then((suggestion) => {
        if (!live) return;
        setSuggesting(false);
        if (suggestion && !nameTouched.current) {
          setForm((current) => ({ ...current, name: suggestion }));
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

  const save = useCallback(() => {
    if (!user || !name) return;
    setSaving(true);
    setSaveError(false);

    const body = {
      name,
      description: form.description,
      point: draft.point,
      sketch,
    };

    const written: Promise<SpotRecord> = draft.recordId
      ? updateSpot(draft.recordId, body)
      : createSpot(body, user.id);

    written
      .then((record) => {
        setActive(record);
        closeDraft();
      })
      .catch((err) => {
        console.warn('[spots] save failed', err);
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
    canSave,
    save,
    abort: closeDraft,
  };
};
