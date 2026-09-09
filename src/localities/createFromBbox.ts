import { toaster } from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { boundingExtent } from 'ol/extent';
import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createLocality,
  LocalityBbox,
  LocalityRecord,
} from '../api/localities';
import { currentUserAtom } from '../auth/atoms';
import { mapAtom } from '../map/atoms';
import { activeLocalityAtom } from './atoms';
import { upsertLocalityOnLayer } from './localityLayer';

// "Ny lokalitet" takes the screen as the rectangle. The old flow armed a
// box-drag and then opened a panel on top of the area just framed, which
// is backwards: what the user wants a lokalitet for is precisely the view
// they are already looking at.
//
// The bbox stays *authored*, not derived — the viewport only seeds it, and
// "Juster området" reshapes it afterwards.

// Clear of the chrome by this much beyond the ribbon's own height, so the
// top edge is visibly inside the map rather than tucked under the bar.
const RIBBON_GAP_PX = 24;

// Side/bottom inset: enough to prove the rectangle is fully on screen, and
// at ≥8% also enough that transformExtent's corner-only reprojection has
// no chance of clipping something the user could see inside the box.
const INSET_FRACTION = 0.08;
const INSET_MIN_PX = 48;

// Below this the rectangle is not worth creating (and screenshot/extract
// both bail on tiny boxes anyway).
const MIN_SIDE_PX = 64;

// minZoom is 3, so an unguarded viewport can be most of Norway — which
// then fires a kulturminner WFS query over the whole country and reports
// an area in six figures. 25 km a side is a generous upper bound on
// something one person walks over.
const MAX_SPAN_M = 25_000;

export type ViewportBboxResult =
  | { ok: true; bbox: LocalityBbox }
  | { ok: false; reason: 'unavailable' | 'tooLarge' };

/**
 * The visible map inset away from the chrome, as EPSG:4326.
 *
 * Pixel corners rather than `View#calculateExtent` and a ratio:
 * `calculateExtent` is symmetric about the view centre and the ribbon only
 * covers the top, so no symmetric ratio can clear it without over-insetting
 * the other three edges. Pixels are relative to the map viewport element,
 * which the ribbon floats over, so the ribbon's height maps 1:1 onto the
 * top inset.
 *
 * Rotation is locked off, so the pixel rectangle stays axis-aligned and two
 * corners describe it.
 */
export const viewportBbox = (map: Map, topInset = 0): ViewportBboxResult => {
  const size = map.getSize();
  if (!size) return { ok: false, reason: 'unavailable' };
  const [width, height] = size;

  const insetX = Math.max(INSET_MIN_PX, Math.round(width * INSET_FRACTION));
  const insetY = Math.max(INSET_MIN_PX, Math.round(height * INSET_FRACTION));
  const left = insetX;
  const right = width - insetX;
  const top = topInset + RIBBON_GAP_PX;
  const bottom = height - insetY;
  if (right - left < MIN_SIDE_PX || bottom - top < MIN_SIDE_PX) {
    return { ok: false, reason: 'unavailable' };
  }

  const topLeft = map.getCoordinateFromPixel([left, top]);
  const bottomRight = map.getCoordinateFromPixel([right, bottom]);
  if (!topLeft || !bottomRight) return { ok: false, reason: 'unavailable' };

  const projection = map.getView().getProjection();
  const extent = boundingExtent([topLeft, bottomRight]);
  const perUnit = projection.getMetersPerUnit() ?? 1;
  if (
    (extent[2] - extent[0]) * perUnit > MAX_SPAN_M ||
    (extent[3] - extent[1]) * perUnit > MAX_SPAN_M
  ) {
    return { ok: false, reason: 'tooLarge' };
  }

  return {
    ok: true,
    bbox: transformExtent(extent, projection, 'EPSG:4326') as LocalityBbox,
  };
};

/**
 * Create the record and put it on the layer. Does not open the workspace —
 * `useLocalityAdjust` builds its extent from whatever bbox is in scope when
 * "Juster området" is pressed, so the caller must have the server record in
 * hand before it becomes the active lokalitet; an optimistic placeholder
 * would leave adjust editing a stale rectangle.
 */
export const createLocalityFromBbox = async (
  bbox: LocalityBbox,
  userId: string,
  name: string,
): Promise<LocalityRecord | null> => {
  try {
    const rec = await createLocality(
      { name, visibility: 'private', bbox },
      userId,
    );
    upsertLocalityOnLayer(rec);
    return rec;
  } catch (e) {
    // Surfaced by the caller — a silent failure here looks like "the
    // button does nothing" (classic cause: pocketbase not restarted after
    // a migration change, so the collection doesn't exist).
    console.warn('[createFromBbox] create failed', e);
    return null;
  }
};

export const useCreateLocalityFromViewport = () => {
  const { t } = useTranslation();
  const map = useAtomValue(mapAtom);
  const user = useAtomValue(currentUserAtom);
  const setActiveLocality = useSetAtom(activeLocalityAtom);
  const [creating, setCreating] = useState(false);

  const create = useCallback(
    async (topInset = 0) => {
      if (!user || creating) return;
      const result = viewportBbox(map, topInset);
      if (!result.ok) {
        toaster.error({
          title:
            result.reason === 'tooLarge'
              ? t('localities.createTooLarge')
              : t('localities.createFailed'),
        });
        return;
      }
      setCreating(true);
      try {
        const rec = await createLocalityFromBbox(
          result.bbox,
          user.id,
          t('localities.defaultName'),
        );
        if (!rec) {
          toaster.error({ title: t('localities.createFailed') });
          return;
        }
        setActiveLocality(rec);
      } finally {
        setCreating(false);
      }
    },
    [user, creating, map, t, setActiveLocality],
  );

  return { create, creating };
};
