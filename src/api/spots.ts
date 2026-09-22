import { pb, SiteUser } from './pocketbase';

const COLLECTION = 'spots';

export type SpotVisibility = 'private' | 'public';

/** [lon, lat] in EPSG:4326 — where the pin was dropped. */
export type SpotPoint = [lon: number, lat: number];

/**
 * An Excalidraw scene plus the georeference that puts it back over the ground
 * it was drawn on. `elements` is the editor's own array, kept opaque here: the
 * only module that knows its shape is `src/sketch/`.
 */
export type SpotSketch = {
  frame: {
    /** View projection at the moment of freezing, e.g. `EPSG:25833`. */
    projection: string;
    /** The ground the frozen viewport covered, in that projection. */
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
  sketch: SpotSketch | null;
  created: string;
  updated: string;
};

export type NewSpotInput = {
  name: string;
  description?: string;
  visibility?: SpotVisibility;
  point: SpotPoint;
  sketch?: SpotSketch | null;
};

export type SpotPatch = Partial<{
  name: string;
  description: string;
  visibility: SpotVisibility;
  point: SpotPoint;
  sketch: SpotSketch | null;
}>;

// Crockford base32, so a code can be read aloud; 32 divides 256, so `% 32` on
// a random byte is unbiased.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const newSpotCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % 32];
  return code;
};

// PB reports a unique-index violation as a 400 with a per-field entry; the
// outer `code` is our field, the inner is PB's name for the error kind.
const isCodeTaken = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.code?.code === 'validation_not_unique';

// 32^6 ≈ 1.07 billion; one redraw is more than enough at this scale.
const CODE_ATTEMPTS = 2;

const accountName = (): string =>
  (pb.authStore.record as SiteUser | null)?.name?.trim() ?? '';

/**
 * PocketBase parses a JSON field for us over REST but hands it back as a
 * string over realtime SSE, so anything that reaches a consumer goes through
 * here first.
 */
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

/**
 * The short link's resolver. Uppercased because SQLite's `=` does not
 * case-fold, and `requestKey: null` because a deep link asks twice — once as
 * whoever arrived, once again after they sign in — and the SDK's auto-cancel
 * would make the second look like a miss.
 */
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
