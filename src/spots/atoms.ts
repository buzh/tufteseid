import { atom, type Setter } from 'jotai';
import type Map from 'ol/Map';

import type { SpotPoint, SpotRecord, SpotSketch } from '../api/spots';
import { mapAtom } from '../map/atoms';
import {
  bboxOverlaps,
  bringBboxIntoView,
  middleCellSquare,
  squareBboxAround,
  squareBboxCovering,
  viewportBbox,
  type Bbox,
} from '../map/bbox';
import { sketchBbox } from '../sketch/bounds';
import { sketchOf } from '../sketch/scene';
import { sketchSessionAtom } from '../sketch/session';
import { terrainAdjustingAtom } from '../terrain/window';
import { DEFAULT_FOOTPRINT_SIDE_M } from './footprint';
import { mayEditSpotAtom } from './mayEdit';

export type SpotDraft = {
  /** New per draft; surfaces key off it to remount. */
  id: string;
  recordId: string | null;
  point: SpotPoint;
  /** `idle` is the box resting: nothing on the map is in the reader's hand. */
  stage: 'idle' | 'pin' | 'footprint' | 'sketch';
  /** Which box the reader is looking at. A `card` draft exists only to hold the
   *  map while the rectangle is dragged or the drawing is edited, so it opens
   *  in a stage and is let go rather than resting at `idle`. */
  box: 'card' | 'editor';
};

export const spotDraftAtom = atom<SpotDraft | null>(null);

export type SpotForm = { name: string; description: string };

export const spotFormAtom = atom<SpotForm>({ name: '', description: '' });

export const spotSketchAtom = atom<SpotSketch | null>(null);

/** Where a rectangle starts: around the drawing if one is on screen, else the
 *  middle of the view. A drawing nowhere near the viewport is not what the
 *  reader is looking at, so it is passed over. */
const seedFootprint = (
  map: Map,
  drawing: SpotSketch | null,
  point: SpotPoint,
): Bbox => {
  const drawn = sketchOf(drawing);
  const bounds = drawn ? sketchBbox(drawn) : null;
  const visible = viewportBbox(map);
  if (bounds && visible && bboxOverlaps(bounds, visible)) {
    return squareBboxCovering(bounds);
  }
  return (
    middleCellSquare(map) ?? squareBboxAround(point, DEFAULT_FOOTPRINT_SIDE_M)
  );
};

/** The draft's footprint, same shape as `SpotFootprint`. */
export const spotFootprintAtom = atom<Bbox | null>(null);

/** Read by `useRectangleAdjust`: the stage is the only record of who has hold
 *  of the map. */
export const spotFootprintAdjustingAtom = atom(
  (get) => get(spotDraftAtom)?.stage === 'footprint',
);

const readingSpotIdAtom = atom<string | null>(null);

const acquiringSpotIdAtom = atom<string | null>(null);

const talkingSpotIdAtom = atom<string | null>(null);

const openSpotAtom = atom<SpotRecord | null>(null);

/** The open spot. Opening a different one — or none — ends the reading of the
 *  last and closes the acquisition box, so no caller has to remember to. */
export const activeSpotAtom = atom(
  (get) => get(openSpotAtom),
  (get, set, next: SpotRecord | null) => {
    if (get(openSpotAtom)?.id !== next?.id) {
      set(readingSpotIdAtom, null);
      set(acquiringSpotIdAtom, null);
      set(talkingSpotIdAtom, null);
    }
    set(openSpotAtom, next);
  },
);

/** The open spot's evidence is being read on the map; a draft suspends the
 *  reading rather than ending it. True regardless for a reader who may not
 *  edit the spot — writing it false does nothing, and they leave by closing
 *  the spot (`docs/architecture.md`). */
export const spotReadingAtom = atom(
  (get) => {
    const active = get(activeSpotAtom);
    if (!active || get(spotDraftAtom)) return false;
    if (!get(mayEditSpotAtom)(active)) return true;
    return get(readingSpotIdAtom) === active.id;
  },
  (get, set, reading: boolean) => {
    set(readingSpotIdAtom, reading ? (get(activeSpotAtom)?.id ?? null) : null);
  },
);

/** The acquisition box stands in front of the card. Held and suspended like
 *  the reading; never reached by a reader who may not edit the spot. */
export const spotAcquiringAtom = atom(
  (get) => {
    const active = get(activeSpotAtom);
    if (!active || get(spotDraftAtom)) return false;
    return get(acquiringSpotIdAtom) === active.id;
  },
  (get, set, acquiring: boolean) => {
    set(
      acquiringSpotIdAtom,
      acquiring ? (get(activeSpotAtom)?.id ?? null) : null,
    );
  },
);

/** The thread box, reached from the card and from the reading alike. Held and
 *  suspended like the other two. Never true for a private spot: the comment
 *  engine has no access control, so not mounting the thread is the only gate,
 *  and `SpotTalk` re-checks. */
export const spotTalkingAtom = atom(
  (get) => {
    const active = get(activeSpotAtom);
    if (!active || get(spotDraftAtom)) return false;
    if (active.visibility !== 'public') return false;
    return get(talkingSpotIdAtom) === active.id;
  },
  (get, set, talking: boolean) => {
    set(talkingSpotIdAtom, talking ? (get(activeSpotAtom)?.id ?? null) : null);
  },
);

/** Derived rather than read apart: a pin drag writes the draft every frame, and
 *  a subscriber on the draft would rebuild the layer behind it. */
export const standingSpotFootprintAtom = atom((get): Bbox | null => {
  if (get(spotFootprintAdjustingAtom)) return null;
  if (get(sketchSessionAtom)) return null;
  return get(spotDraftAtom)
    ? get(spotFootprintAtom)
    : (get(activeSpotAtom)?.footprint ?? null);
});

/** The one spot the pin layer leaves undrawn: a draft, whose pin is
 *  `pinAdjust.ts`'s to draw, or an open spot whose footprint frame stands in
 *  the pin's place. A row from before the rectangle rule has no frame and
 *  nobody repairs one for a reader who may not edit it, so its pin stays or
 *  the spot is marked by nothing at all.
 *
 *  Derived, so the pin drag writing the draft every frame only restyles the
 *  layer when the id changes. */
export const unpinnedSpotIdAtom = atom((get): string | null => {
  const draft = get(spotDraftAtom);
  if (draft) return draft.recordId;
  const active = get(activeSpotAtom);
  return active?.footprint ? active.id : null;
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
    stage: 'idle',
    box: 'editor',
  });
  set(spotFormAtom, { name: '', description: '' });
  set(spotFootprintAtom, null);
  set(spotSketchAtom, null);
});

const openOn = (set: Setter, record: SpotRecord, box: SpotDraft['box']) => {
  draftCounter += 1;
  set(spotPlacingAtom, false);
  set(spotDraftAtom, {
    id: `draft-${draftCounter}`,
    recordId: record.id,
    point: record.point,
    stage: 'idle',
    box,
  });
  set(spotFormAtom, {
    name: record.name,
    description: record.description,
  });
  set(spotFootprintAtom, record.footprint);
  set(spotSketchAtom, record.sketch);
};

export const editSpotDraftAtom = atom(null, (_get, set, record: SpotRecord) => {
  openOn(set, record, 'editor');
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
    if (stage === 'footprint' || stage === 'sketch') {
      // The terrain rectangle lets go of the map: only one
      // `useRectangleAdjust` may be live, or neither frame can be grabbed, and
      // the sketch canvas freezes the map's interactions under it.
      set(terrainAdjustingAtom, false);
    }
    if (stage === 'footprint') {
      const map = get(mapAtom);
      const rect =
        get(spotFootprintAtom) ??
        seedFootprint(map, get(spotSketchAtom), draft.point);
      set(spotFootprintAtom, rect);
      // A rectangle nobody can see is a rectangle nobody can drag.
      bringBboxIntoView(map, rect);
    }
    set(spotDraftAtom, { ...draft, stage });
  },
);

/** Let go of the map without losing the rectangle — the other side of the
 *  one-at-a-time rule `setSpotStageAtom` keeps. The editor keeps its box and
 *  rests; a card draft is nothing but the hold, so it goes, and its unmount
 *  writes what was dragged. */
export const releaseSpotFootprintAtom = atom(null, (get, set) => {
  const draft = get(spotDraftAtom);
  if (draft?.stage !== 'footprint') return;
  if (draft.box === 'card') set(closeSpotDraftAtom);
  else set(spotDraftAtom, { ...draft, stage: 'idle' });
});

/** Take hold of the map from the card, which stays on screen. */
export const adjustSpotDraftAtom = atom(
  null,
  (_get, set, record: SpotRecord, stage: 'footprint' | 'sketch') => {
    openOn(set, record, 'card');
    set(setSpotStageAtom, stage);
  },
);
