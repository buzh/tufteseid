import { pb, SiteUser } from './pocketbase';

const COLLECTION = 'spots';

export type SpotVisibility = 'private' | 'public';

/** Lon/lat, EPSG:4326. */
export type SpotPoint = [lon: number, lat: number];

/** The ground the spot's evidence covers, EPSG:4326. Structurally the `Bbox` of
 *  `src/map/bbox.ts`, restated here so this module stays clear of OpenLayers. */
export type SpotFootprint = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

/** An Excalidraw scene plus its georeference; only `src/sketch/` reads
 *  `elements`. */
export type SpotSketch = {
  frame: {
    /** View projection at freeze, e.g. `EPSG:25833`. */
    projection: string;
    /** The frozen viewport's ground, in that projection. */
    extent: [number, number, number, number];
    widthPx: number;
    heightPx: number;
  };
  elements: unknown[];
};

export type SpotRecord = {
  id: string;
  owner: string;
  code: string;
  name: string;
  description: string;
  credit: string;
  visibility: SpotVisibility;
  point: SpotPoint;
  /** Null until the reader places one; only then can evidence be kept. */
  footprint: SpotFootprint | null;
  sketch: SpotSketch | null;
  created: string;
  updated: string;
};

// Mirrors the column widths in `pb_migrations/1700001100_spots.js`.
export const SPOT_NAME_MAX = 200;
export const SPOT_DESCRIPTION_MAX = 20000;

export type NewSpotInput = {
  name: string;
  description?: string;
  visibility?: SpotVisibility;
  point: SpotPoint;
  footprint?: SpotFootprint | null;
  sketch?: SpotSketch | null;
};

export type SpotPatch = Partial<{
  name: string;
  description: string;
  visibility: SpotVisibility;
  point: SpotPoint;
  footprint: SpotFootprint | null;
  sketch: SpotSketch | null;
}>;

// Crockford base32; 32 divides 256, so `% 32` on a random byte is unbiased.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const newSpotCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % 32];
  return code;
};

// PocketBase reports a unique-index violation as a 400 with a per-field entry:
// the outer `code` is our field, the inner is its name for the error kind.
const isCodeTaken = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.code?.code === 'validation_not_unique';

// 32^6 ≈ 1.07e9 codes, so one redraw suffices.
const CODE_ATTEMPTS = 2;

const accountName = (): string =>
  (pb.authStore.record as SiteUser | null)?.name?.trim() ?? '';

// PocketBase parses a JSON field over REST but hands it back as a string over
// realtime SSE.
const asJson = <T>(value: unknown): T | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const hydrate = (raw: SpotRecord): SpotRecord => ({
  ...raw,
  point: asJson<SpotPoint>(raw.point) ?? [0, 0],
  footprint: asJson<SpotFootprint>(raw.footprint),
  sketch: asJson<SpotSketch>(raw.sketch),
});

export const createSpot = async (
  input: NewSpotInput,
  ownerId: string,
): Promise<SpotRecord> => {
  const record = {
    owner: ownerId,
    name: input.name,
    description: input.description ?? '',
    credit: accountName(),
    visibility: input.visibility ?? 'private',
    point: input.point,
    footprint: input.footprint ?? null,
    sketch: input.sketch ?? null,
  };

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await pb
        .collection(COLLECTION)
        .create<SpotRecord>({ ...record, code: newSpotCode() });
      return hydrate(created);
    } catch (err) {
      if (attempt >= CODE_ATTEMPTS || !isCodeTaken(err)) throw err;
    }
  }
};

export const updateSpot = async (
  id: string,
  patch: SpotPatch,
): Promise<SpotRecord> =>
  hydrate(await pb.collection(COLLECTION).update<SpotRecord>(id, patch));

export const deleteSpot = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

export const listSpots = async (): Promise<SpotRecord[]> =>
  (
    await pb.collection(COLLECTION).getFullList<SpotRecord>({
      sort: '-updated',
    })
  ).map(hydrate);

// Uppercased because SQLite's `=` does not case-fold. `requestKey: null`
// opts out of the SDK's auto-cancel: a deep link asks twice, before and after
// sign-in.
export const getSpotByCode = async (code: string): Promise<SpotRecord> =>
  hydrate(
    await pb
      .collection(COLLECTION)
      .getFirstListItem<SpotRecord>(
        pb.filter('code = {:code}', { code: code.toUpperCase() }),
        { requestKey: null },
      ),
  );

export const subscribeSpots = (
  handler: (action: string, record: SpotRecord) => void,
): (() => void) => {
  const pending = pb
    .collection(COLLECTION)
    .subscribe<SpotRecord>('*', (e) => handler(e.action, hydrate(e.record)));
  return () => {
    void pending.then((unsubscribe) => unsubscribe()).catch(() => {});
  };
};
