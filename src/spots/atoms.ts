import { atom } from 'jotai';

import type { SpotPoint, SpotRecord, SpotSketch } from '../api/spots';

export type SpotDraft = {
  /** New every time a pin goes down; surfaces key off it to remount. */
  id: string;
  recordId: string | null;
  point: SpotPoint;
  stage: 'pin' | 'sketch';
};

export const spotDraftAtom = atom<SpotDraft | null>(null);

export type SpotForm = { name: string; description: string };

export const spotFormAtom = atom<SpotForm>({ name: '', description: '' });

export const spotSketchAtom = atom<SpotSketch | null>(null);

export const activeSpotAtom = atom<SpotRecord | null>(null);

/** The `+` is armed: the next click on the map places the pin. Exclusive with
 *  `spotDraftAtom` — every writer of the draft clears this. */
export const spotPlacingAtom = atom(false);

let draftCounter = 0;

export const placeSpotDraftAtom = atom(null, (_get, set, point: SpotPoint) => {
  draftCounter += 1;
  set(spotPlacingAtom, false);
  set(spotDraftAtom, {
    id: `draft-${draftCounter}`,
    recordId: null,
    point,
    stage: 'pin',
  });
  set(spotFormAtom, { name: '', description: '' });
  set(spotSketchAtom, null);
});

export const editSpotDraftAtom = atom(null, (_get, set, record: SpotRecord) => {
  draftCounter += 1;
  set(spotPlacingAtom, false);
  set(spotDraftAtom, {
    id: `draft-${draftCounter}`,
    recordId: record.id,
    point: record.point,
    stage: 'pin',
  });
  set(spotFormAtom, {
    name: record.name,
    description: record.description,
  });
  set(spotSketchAtom, record.sketch);
});

export const closeSpotDraftAtom = atom(null, (_get, set) => {
  set(spotPlacingAtom, false);
  set(spotDraftAtom, null);
  set(spotFormAtom, { name: '', description: '' });
  set(spotSketchAtom, null);
});

export const setSpotStageAtom = atom(
  null,
  (get, set, stage: SpotDraft['stage']) => {
    const draft = get(spotDraftAtom);
    if (!draft || draft.stage === stage) return;
    set(spotDraftAtom, { ...draft, stage });
  },
);
