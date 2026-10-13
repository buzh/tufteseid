import { pb, SiteUser } from './pocketbase';

const COLLECTION = 'spots';

export type SpotVisibility = 'private' | 'public';

export type SpotPoint = [lon: number, lat: number];

export type SpotFootprint = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

export type SpotSketch = {
  frame: {

    projection: string;

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

  footprint: SpotFootprint | null;
  sketch: SpotSketch | null;

  mapSketch: string;
  created: string;
  updated: string;
};

export const MAP_SKETCH_COLUMN = 'sketch';

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
  mapSketch: string;
}>;

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const newSpotCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % 32];
  return code;
};

const isCodeTaken = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.code?.code === 'validation_not_unique';

const CODE_ATTEMPTS = 2;

const accountName = (): string =>
  (pb.authStore.record as SiteUser | null)?.name?.trim() ?? '';

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
