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

// Where a new rectangle is seeded from, and how one is written. "Ny lokalitet"
// seeds from the visible map and hands the rectangle to the author to place;
// `Opprett` (placement.ts) is what writes. Terreng's standalone window
// (`src/terrain/window.ts`) frames the same rectangle, so the two agree about
// what "the visible map" means.

// At ≥8%, enough that transformExtent's corner-only reprojection cannot clip.
const INSET_FRACTION = 0.08;
const INSET_MIN_PX = 48;

// Chrome plus insets can eat a short window whole.
const MIN_SIDE_PX = 64;

/**
 * The visible map inset away from the chrome, or null when the chrome leaves
 * nothing to frame. Pixel corners rather than `View#calculateExtent`, which is
 * symmetric about the view centre while the chrome is not; rotation is off, so
 * two corners describe the rectangle.
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

  // No ceiling here: the callers clamp the seed into the band, so zooming
  // right out gives a `MAX_SIDE_M` rectangle rather than a refusal.
  const projection = map.getView().getProjection();
  const extent = boundingExtent([topLeft, bottomRight]);
  return transformExtent(extent, projection, 'EPSG:4326') as LocalityBbox;
};

/**
 * Creates the record and puts it on the layer, without opening the workspace:
 * the caller needs the server record in hand, since an optimistic placeholder
 * would leave "Juster området" editing a stale rectangle. The registers are
 * asked before the write, so the ribbon never renames under the cursor.
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
    // Surfaced by the caller: a silent failure looks like a dead button, and
    // is usually pocketbase not restarted after a migration.
    console.warn('[createFromBbox] create failed', e);
    return null;
  }
};
