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
import { CHROME_MARGIN_PX, chromeInsets } from '../shell/chromeInsets';
import { toast } from '../ui';
import { activeLocalityAtom, editingLocalityIdAtom } from './atoms';
import { fetchLocalityContext } from './localityContext';
import { upsertLocalityOnLayer } from './localityLayer';

// "Ny lokalitet" takes the screen as the rectangle. The old flow armed a
// box-drag and then opened a panel on top of the area just framed, which
// is backwards: what the user wants a lokalitet for is precisely the view
// they are already looking at.
//
// The bbox stays *authored*, not derived — the viewport only seeds it, and
// "Juster området" reshapes it afterwards.

// Inset: enough to prove the rectangle is fully on screen, and
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
 * `calculateExtent` is symmetric about the view centre while the chrome is
 * not — a ribbon on top and a dock on the right — so no symmetric ratio can
 * clear it without over-insetting the other edges. Pixels are relative to the
 * map viewport element, which every surface floats over, so the measured
 * chrome insets map 1:1 onto the pixel insets.
 *
 * Each edge takes whichever is larger, the chrome in front of it or the
 * proportional inset: with nothing docked this is exactly the old symmetric
 * rectangle, and with the dock open the right edge moves in to clear it.
 *
 * Rotation is locked off, so the pixel rectangle stays axis-aligned and two
 * corners describe it.
 */
export const viewportBbox = (map: Map): ViewportBboxResult => {
  const size = map.getSize();
  if (!size) return { ok: false, reason: 'unavailable' };
  const [width, height] = size;

  const insetX = Math.max(INSET_MIN_PX, Math.round(width * INSET_FRACTION));
  const insetY = Math.max(INSET_MIN_PX, Math.round(height * INSET_FRACTION));
  const [chromeTop, chromeRight, chromeBottom, chromeLeft] = chromeInsets(map);
  const clear = (chrome: number) => chrome + CHROME_MARGIN_PX;

  const left = Math.max(insetX, clear(chromeLeft));
  const right = width - Math.max(insetX, clear(chromeRight));
  const top = Math.max(insetY, clear(chromeTop));
  const bottom = height - Math.max(insetY, clear(chromeBottom));
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
 *
 * The registers are asked what this rectangle is called *before* the record
 * is written, not patched in afterwards: creating and then renaming would
 * open the ribbon on "Uten navn", auto-focus its rename field (which fires
 * on exactly that name), and then change the text under the user's cursor.
 * `fallbackName` is what survives when GeoNorge has nothing — open sea,
 * across the border, or the service being down.
 */
export const createLocalityFromBbox = async (
  bbox: LocalityBbox,
  userId: string,
  fallbackName: string,
): Promise<LocalityRecord | null> => {
  try {
    const context = await fetchLocalityContext(bbox);
    const rec = await createLocality(
      {
        name: context.place || fallbackName,
        place: context.place,
        municipality: context.municipality,
        matrikkel: context.matrikkel,
        visibility: 'private',
        bbox,
      },
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
  const setEditingLocalityId = useSetAtom(editingLocalityIdAtom);
  const [creating, setCreating] = useState(false);

  const create = useCallback(async () => {
    if (!user || creating) return;
    const result = viewportBbox(map);
    if (!result.ok) {
      toast.error({
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
        toast.error({ title: t('localities.createFailed') });
        return;
      }
      // The one exception to "every lokalitet opens in show"
      // (docs/lokalitet-view.md §3): a rectangle framed thirty seconds ago
      // has nothing to show, and making the first press on every fresh site
      // be "Rediger" is a click that teaches nothing. Set in the same batch
      // as the active record, so the row never renders it in show first.
      setActiveLocality(rec);
      setEditingLocalityId(rec.id);
    } finally {
      setCreating(false);
    }
  }, [user, creating, map, t, setActiveLocality, setEditingLocalityId]);

  return { create, creating };
};
