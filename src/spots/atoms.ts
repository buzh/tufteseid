import { atom } from 'jotai';

import type { SpotPoint, SpotRecord, SpotSketch } from '../api/spots';
import { squareBboxAround, type Bbox } from '../map/bbox';

export type SpotDraft = {
  /** New per draft; surfaces key off it to remount. */
  id: string;
  recordId: string | null;
  point: SpotPoint;
  stage: 'pin' | 'footprint' | 'sketch';
};

export const spotDraftAtom = atom<SpotDraft | null>(null);

export type SpotForm = { name: string; description: string };

export const spotFormAtom = atom<SpotForm>({ name: '', description: '' });

export const spotSketchAtom = atom<SpotSketch | null>(null);

/** What a square gets when the reader has not sized one: wide enough to hold a
 *  farmstead, well inside `MAX_SIDE_M`. */
export const DEFAULT_FOOTPRINT_SIDE_M = 200;

/** The draft's footprint. Null is a spot naming no ground, and a spot nothing
 *  can be kept against. Same shape as `SpotFootprint`. */
export const spotFootprintAtom = atom<Bbox | null>(null);

/** Read by `useRectangleAdjust`: the stage is the only record of who has hold
 *  of the map. */
export const spotFootprintAdjustingAtom = atom(
  (get) => get(spotDraftAtom)?.stage === 'footprint',
);

export const activeSpotAtom = atom<SpotRecord | null>(null);

const readingSpotIdAtom = atom<string | null>(null);

/**
 * The open spot's evidence is being read on the map. Held as the id it was
 * entered on and compared against the open record, so closing the spot,
 * opening another or starting a draft ends the reading without any of them
 * having to remember to.
 */
export const spotReadingAtom = atom(
  (get) => {
    const active = get(activeSpotAtom);
    if (!active || get(spotDraftAtom)) return false;
    return get(readingSpotIdAtom) === active.id;
  },
  (get, set, reading: boolean) => {
    set(readingSpotIdAtom, reading ? (get(activeSpotAtom)?.id ?? null) : null);
  },
);

/**
 * The footprint a standing frame should draw, or null. A draft's own wins over
 * the open spot's: while one is being edited it is the only rectangle that
 * means anything. Derived rather than read apart, so a pin drag — which writes
 * the draft every frame — does not rebuild the layer behind it.
 */
export const shownSpotFootprintAtom = atom((get): Bbox | null => {
  if (get(spotFootprintAdjustingAtom)) return null;
  return get(spotDraftAtom)
    ? get(spotFootprintAtom)
    : (get(activeSpotAtom)?.footprint ?? null);
});

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
  set(spotFootprintAtom, null);
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
  set(spotFootprintAtom, record.footprint);
  set(spotSketchAtom, record.sketch);
});

export const closeSpotDraftAtom = atom(null, (_get, set) => {
  set(spotPlacingAtom, false);
  set(spotDraftAtom, null);
  set(spotFormAtom, { name: '', description: '' });
  set(spotFootprintAtom, null);
  set(spotSketchAtom, null);
});

export const setSpotStageAtom = atom(
  null,
  (get, set, stage: SpotDraft['stage']) => {
    const draft = get(spotDraftAtom);
    if (!draft || draft.stage === stage) return;
    // Seeded on the pin rather than on the viewport, so the ground a keep will
    // cover is the ground the spot is about however far the map has been
    // scrolled since.
    if (stage === 'footprint' && !get(spotFootprintAtom)) {
      set(
        spotFootprintAtom,
        squareBboxAround(draft.point, DEFAULT_FOOTPRINT_SIDE_M),
      );
    }
    set(spotDraftAtom, { ...draft, stage });
  },
);

export const clearSpotFootprintAtom = atom(null, (get, set) => {
  set(spotFootprintAtom, null);
  const draft = get(spotDraftAtom);
  // Otherwise the stage would stand with no rectangle to place, and
  // `setSpotStageAtom` would not seed a new one without a round trip.
  if (draft?.stage === 'footprint') {
    set(spotDraftAtom, { ...draft, stage: 'pin' });
  }
});
