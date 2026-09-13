import { boundingExtent } from 'ol/extent';
import type Map from 'ol/Map';
import { transformExtent } from 'ol/proj';
import {
  createLocality,
  LocalityBbox,
  LocalityRecord,
} from '../api/localities';
import { CHROME_MARGIN_PX, chromeInsets } from '../shell/chromeInsets';
import { fetchLocalityContext } from './localityContext';
import { upsertLocalityOnLayer } from './localityLayer';

// Where a new lokalitet's rectangle starts, and how one is written.
//
// "Ny lokalitet" does not create anything any more: it seeds a rectangle from
// the visible map and hands it to the author to move and size, and `Opprett` is
// what writes (`placement.ts`, docs/ui-architecture.md §5.6). So the viewport is
// the *seed* and nothing else — the bbox was always authored rather than
// derived, and now the authoring happens before the record exists rather than
// after.

// Inset: enough to prove the rectangle is fully on screen, and
// at ≥8% also enough that transformExtent's corner-only reprojection has
// no chance of clipping something the user could see inside the box.
const INSET_FRACTION = 0.08;
const INSET_MIN_PX = 48;

// Below this there is nothing on screen worth seeding from — chrome plus
// insets can eat a short window whole.
const MIN_SIDE_PX = 64;

/**
 * The visible map inset away from the chrome, as EPSG:4326. `null` when the
 * chrome leaves nothing to frame.
 *
 * Pixel corners rather than `View#calculateExtent` and a ratio:
 * `calculateExtent` is symmetric about the view centre while the chrome is
 * not — a ribbon on top, a filmstrip along the bottom, an infobox on the
 * right — so no symmetric ratio can clear it without over-insetting the other
 * edges. Pixels are relative to the map viewport element, which every surface
 * floats over, so the measured chrome insets map 1:1 onto the pixel insets.
 *
 * Each edge takes whichever is larger, the chrome in front of it or the
 * proportional inset: with the map bare this is exactly the old symmetric
 * rectangle, and each surface that is up moves its own edge in to clear
 * itself.
 *
 * Rotation is locked off, so the pixel rectangle stays axis-aligned and two
 * corners describe it.
 */
export const viewportBbox = (map: Map): LocalityBbox | null => {
  const size = map.getSize();
  if (!size) return null;
  const [width, height] = size;

  const insetX = Math.max(INSET_MIN_PX, Math.round(width * INSET_FRACTION));
  const insetY = Math.max(INSET_MIN_PX, Math.round(height * INSET_FRACTION));
  const [chromeTop, chromeRight, chromeBottom, chromeLeft] = chromeInsets(map);
  const clear = (chrome: number) => chrome + CHROME_MARGIN_PX;

  const left = Math.max(insetX, clear(chromeLeft));
  const right = width - Math.max(insetX, clear(chromeRight));
  const top = Math.max(insetY, clear(chromeTop));
  const bottom = height - Math.max(insetY, clear(chromeBottom));
  if (right - left < MIN_SIDE_PX || bottom - top < MIN_SIDE_PX) return null;

  const topLeft = map.getCoordinateFromPixel([left, top]);
  const bottomRight = map.getCoordinateFromPixel([right, bottom]);
  if (!topLeft || !bottomRight) return null;

  // No ceiling here any more. The viewport can be most of Norway (minZoom is
  // 3) and that used to be a refusal — `MAX_SPAN_M`, 25 km, a number about the
  // view rather than about anything that has to render it. It is the placement
  // step's job now: the seed is clamped into the size band on the way in
  // (`clampBboxSize`), so zooming out gets you a 1500 m rectangle on the middle
  // of the screen instead of a toast.
  const projection = map.getView().getProjection();
  const extent = boundingExtent([topLeft, bottomRight]);
  return transformExtent(extent, projection, 'EPSG:4326') as LocalityBbox;
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
