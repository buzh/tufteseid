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
  id: string;
  recordId: string | null;
  point: SpotPoint;
  stage: 'idle' | 'pin' | 'footprint' | 'sketch';
  box: 'card' | 'editor';
};

export const spotDraftAtom = atom<SpotDraft | null>(null);

export type SpotForm = { name: string; description: string };

export const spotFormAtom = atom<SpotForm>({ name: '', description: '' });

export const spotSketchAtom = atom<SpotSketch | null>(null);

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

export const spotFootprintAtom = atom<Bbox | null>(null);

export const spotFootprintAdjustingAtom = atom(
  (get) => get(spotDraftAtom)?.stage === 'footprint',
);

const readingSpotIdAtom = atom<string | null>(null);

const openSpotAtom = atom<SpotRecord | null>(null);

export const activeSpotAtom = atom(
  (get) => get(openSpotAtom),
  (get, set, next: SpotRecord | null) => {
    if (get(openSpotAtom)?.id !== next?.id) set(readingSpotIdAtom, null);
    set(openSpotAtom, next);
  },
);

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

export const standingSpotFootprintAtom = atom((get): Bbox | null => {
  if (get(spotFootprintAdjustingAtom)) return null;
  if (get(sketchSessionAtom)) return null;
  return get(spotDraftAtom)
    ? get(spotFootprintAtom)
    : (get(activeSpotAtom)?.footprint ?? null);
});

export const unpinnedSpotIdAtom = atom((get): string | null => {
  const draft = get(spotDraftAtom);
  if (draft) return draft.recordId;
  const active = get(activeSpotAtom);
  return active?.footprint ? active.id : null;
});

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
      set(terrainAdjustingAtom, false);
    }
    if (stage === 'footprint') {
      const map = get(mapAtom);
      const rect =
        get(spotFootprintAtom) ??
        seedFootprint(map, get(spotSketchAtom), draft.point);
      set(spotFootprintAtom, rect);
      bringBboxIntoView(map, rect);
    }
    set(spotDraftAtom, { ...draft, stage });
  },
);

export const releaseSpotFootprintAtom = atom(null, (get, set) => {
  const draft = get(spotDraftAtom);
  if (draft?.stage !== 'footprint') return;
  if (draft.box === 'card') set(closeSpotDraftAtom);
  else set(spotDraftAtom, { ...draft, stage: 'idle' });
});

export const adjustSpotDraftAtom = atom(
  null,
  (_get, set, record: SpotRecord, stage: 'footprint' | 'sketch') => {
    openOn(set, record, 'card');
    set(setSpotStageAtom, stage);
  },
);
