import { atom } from 'jotai';

import type { SpotPoint, SpotRecord, SpotSketch } from '../api/spots';

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
   * A new value every time a pin goes down. Surfaces key off it, so opening a
   * second draft remounts them rather than leaving the first one's component
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

/**
 * The `+` is armed: the pin is on the cursor and the next click on the map is
 * where it goes. There is no draft yet — nothing has been named, nothing can be
 * abandoned — which is why this is an atom of its own rather than a third
 * `stage`, the way `terrainAdjustingAtom` stands beside the terrain window.
 *
 * A pin the reader places is a pin they aimed. Putting one down for them at the
 * centre of the screen and inviting them to drag it made the first gesture a
 * correction of the app's guess, and left a draft open over ground nobody had
 * pointed at.
 *
 * Armed and drafting are exclusive: every writer of `spotDraftAtom` below
 * clears this, so there is never a pin on the cursor and a pin in the hand.
 */
export const spotPlacingAtom = atom(false);

let draftCounter = 0;

/**
 * Put the pin down, and open the box beside it. The stage is `pin`, so the
 * placement can still be nudged by dragging it.
 *
 * Nothing is written to the server here. A draft is free until `Lagre`, which
 * is what lets a reader place one, look at the relief, and abandon it.
 */
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

/** Open an existing spot for another edit. It keeps the point it was saved at —
 *  a spot that is already somewhere is not placed again, it is corrected — and
 *  the pin is live, so dragging it is how that correction is made. */
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

/** Put the draft down — saved, or abandoned. All of it, so the next `+` starts clean. */
export const closeSpotDraftAtom = atom(null, (_get, set) => {
  set(spotPlacingAtom, false);
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
