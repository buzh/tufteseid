import { atom } from 'jotai';

import type { SpotPoint, SpotRecord, SpotSketch } from '../api/spots';
import { squareBboxAround, type Bbox } from '../map/bbox';
import { terrainAdjustingAtom } from '../terrain/window';
import { mayEditSpotAtom } from './mayEdit';

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
const DEFAULT_FOOTPRINT_SIDE_M = 200;

/** The draft's footprint, same shape as `SpotFootprint`. */
export const spotFootprintAtom = atom<Bbox | null>(null);

/** Read by `useRectangleAdjust`: the stage is the only record of who has hold
 *  of the map. */
export const spotFootprintAdjustingAtom = atom(
  (get) => get(spotDraftAtom)?.stage === 'footprint',
);

const readingSpotIdAtom = atom<string | null>(null);

const openSpotAtom = atom<SpotRecord | null>(null);

/** The open spot. Opening a different one — or none — ends the reading of the
 *  last, so no caller has to remember to. */
export const activeSpotAtom = atom(
  (get) => get(openSpotAtom),
  (get, set, next: SpotRecord | null) => {
    if (get(openSpotAtom)?.id !== next?.id) set(readingSpotIdAtom, null);
    set(openSpotAtom, next);
  },
);

/** The open spot's evidence is being read on the map. A draft only suspends the
 *  reading — closing one returns to it.
 *
 *  A reader who may not edit the spot gets the reading and nothing else: there
 *  is no card behind it to step back to, so opening such a spot is a reading
 *  and ending one closes the spot. */
export const spotReadingAtom = atom(
  (get) => {
    const active = get(activeSpotAtom);
    if (!active || get(spotDraftAtom)) return false;
    if (!get(mayEditSpotAtom)(active)) return true;
    return get(readingSpotIdAtom) === active.id;
  },
  (get, set, reading: boolean) => {
    const active = get(activeSpotAtom);
    if (!reading && !get(mayEditSpotAtom)(active)) {
      set(activeSpotAtom, null);
      return;
    }
    set(readingSpotIdAtom, reading ? (active?.id ?? null) : null);
  },
);

/** Derived rather than read apart: a pin drag writes the draft every frame, and
 *  a subscriber on the draft would rebuild the layer behind it. */
export const standingSpotFootprintAtom = atom((get): Bbox | null => {
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
    if (stage === 'footprint') {
      // Only one `useRectangleAdjust` may be live: two would put two frames and
      // two pointer interactions on the map, and neither could be grabbed.
      set(terrainAdjustingAtom, false);
      if (!get(spotFootprintAtom)) {
        set(
          spotFootprintAtom,
          squareBboxAround(draft.point, DEFAULT_FOOTPRINT_SIDE_M),
        );
      }
    }
    set(spotDraftAtom, { ...draft, stage });
  },
);

/** Let go of the map without losing the rectangle — the other side of the
 *  one-at-a-time rule `setSpotStageAtom` keeps. */
export const releaseSpotFootprintAtom = atom(null, (get, set) => {
  const draft = get(spotDraftAtom);
  if (draft?.stage === 'footprint') {
    set(spotDraftAtom, { ...draft, stage: 'pin' });
  }
});

export const clearSpotFootprintAtom = atom(null, (get, set) => {
  set(spotFootprintAtom, null);
  const draft = get(spotDraftAtom);
  // Otherwise the stage would stand with no rectangle to place, and
  // `setSpotStageAtom` would not seed a new one without a round trip.
  if (draft?.stage === 'footprint') {
    set(spotDraftAtom, { ...draft, stage: 'pin' });
  }
});
