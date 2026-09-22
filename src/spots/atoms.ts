import { atom } from 'jotai';

import type { SpotPoint, SpotRecord, SpotSketch } from '../api/spots';
import { mapAtom } from '../map/atoms';
import { viewportCentre4326 } from './geo';

/**
 * A spot being authored, or null for none. Everything the surface does is a
 * write to this and the two atoms under it; the `+` in the band holds nothing.
 *
 * Three atoms rather than one, and the split is by who writes them at what
 * rate. This one is written by the pin drag, sixty times a second, and read by
 * the pin layer and by the coordinate line in the box. `spotFormAtom` is
 * written by a keystroke and read by nobody on the map. `spotSketchAtom` is
 * written when the editor closes and is the largest of the three. Folded into
 * one atom, a typed character would redraw the pin and a dragged pin would
 * re-render two text inputs.
 */
export type SpotDraft = {
  /**
   * A new value every time the `+` is pressed. Surfaces key off it, so opening
   * a second draft remounts them rather than leaving the first one's component
   * state behind.
   */
  id: string;
  /** The record being edited, or null while the spot has never been saved. */
  recordId: string | null;
  point: SpotPoint;
  /**
   * Which of the two on-map gestures has the pointer, and never both: the
   * sketch canvas covers the map and would swallow a drag aimed at the pin.
   * `pin` is where a draft opens — the first thing to say about a spot is
   * where it is.
   */
  stage: 'pin' | 'sketch';
};

export const spotDraftAtom = atom<SpotDraft | null>(null);

export type SpotForm = { name: string; description: string };

export const spotFormAtom = atom<SpotForm>({ name: '', description: '' });

export const spotSketchAtom = atom<SpotSketch | null>(null);

/**
 * The spot a short link resolved or a click opened, drawn on the map and read
 * out in a card. Independent of the draft: a reader may be looking at
 * somebody's public spot and have one of their own half-written.
 */
export const activeSpotAtom = atom<SpotRecord | null>(null);

let draftCounter = 0;

/**
 * Start a new spot at the centre of what is on the screen, with the pin live
 * so it can be dragged onto the thing it is about. False means the map has no
 * size yet — before first layout — which is not a state a reader can be in and
 * which the caller therefore passes over in silence.
 *
 * Nothing is written to the server here. A draft is free until `Lagre`, which
 * is what lets a reader open one, look at the relief, and abandon it.
 */
export const openSpotDraftAtom = atom(null, (get, set): boolean => {
  const centre = viewportCentre4326(get(mapAtom));
  if (!centre) return false;
  draftCounter += 1;
  set(spotDraftAtom, {
    id: `draft-${draftCounter}`,
    recordId: null,
    point: centre,
    stage: 'pin',
  });
  set(spotFormAtom, { name: '', description: '' });
  set(spotSketchAtom, null);
  return true;
});

/** Open an existing spot for another edit, pin first, exactly as a new one. */
export const editSpotDraftAtom = atom(null, (_get, set, record: SpotRecord) => {
  draftCounter += 1;
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

/** Put the draft down — saved, or abandoned. All three, so the next `+` starts clean. */
export const closeSpotDraftAtom = atom(null, (_get, set) => {
  set(spotDraftAtom, null);
  set(spotFormAtom, { name: '', description: '' });
  set(spotSketchAtom, null);
});

/** Hand the pointer to the pin, or to the canvas. Inert with no draft open. */
export const setSpotStageAtom = atom(
  null,
  (get, set, stage: SpotDraft['stage']) => {
    const draft = get(spotDraftAtom);
    if (!draft || draft.stage === stage) return;
    set(spotDraftAtom, { ...draft, stage });
  },
);
