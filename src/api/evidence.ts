import { pb } from './pocketbase';

const COLLECTION = 'evidence';

/** Which producer made the pixels. Mirrors the `kind` select values in
 *  `pb_migrations/1700001300_evidence.js`. */
export type EvidenceKind = 'lidar' | 'terrain' | 'flyfoto';

/** Free-form per kind, and read back through `src/evidence/spec.ts` rather than
 *  trusted: it is a JSON column, and a render is only citable if the row that
 *  describes it can be checked. Server-side ceiling is 10 kB. */
export type EvidenceMeta = Record<string, unknown>;

export type EvidenceRecord = {
  id: string;
  spot: string;
  owner: string;
  kind: EvidenceKind;
  /** Empty between the ask and the render landing — test it, do not assume. */
  file: string;
  caption: string;
  meta: EvidenceMeta | null;
  /** Opaque ordering key; see `nextEvidenceSort`. */
  sort: number;
  created: string;
  updated: string;
  // Set by PocketBase on fetched records; `pb.files.getURL` needs one of them.
  collectionId?: string;
  collectionName?: string;
};

export type NewEvidenceInput = {
  spot: string;
  kind: EvidenceKind;
  caption?: string;
  meta?: EvidenceMeta;
};

// Epoch milliseconds, so a producer that does not hold the list still lands
// last.
const nextEvidenceSort = () => Date.now();

// PocketBase parses a JSON field over REST but hands it back as a string over
// realtime SSE. Same rule as `spots.ts`.
const asJson = <T>(value: unknown): T | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const hydrate = (raw: EvidenceRecord): EvidenceRecord => ({
  ...raw,
  meta: asJson<EvidenceMeta>(raw.meta),
});

/** The row before its pixels: the parameters are written first so a render that
 *  fails has a record to retry against. */
export const createEvidence = async (
  input: NewEvidenceInput,
  ownerId: string,
): Promise<EvidenceRecord> =>
  hydrate(
    await pb.collection(COLLECTION).create<EvidenceRecord>({
      spot: input.spot,
      owner: ownerId,
      kind: input.kind,
      caption: input.caption ?? '',
      meta: input.meta ?? {},
      sort: nextEvidenceSort(),
    }),
  );

/**
 * The pixels for an existing row. `meta` goes up in the same request so a
 * record can never hold a file its meta does not describe; pass the whole of
 * it, since PocketBase replaces a JSON field wholesale.
 */
export const attachEvidenceFile = async (
  id: string,
  blob: Blob,
  filename: string,
  meta: EvidenceMeta,
): Promise<EvidenceRecord> => {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('meta', JSON.stringify(meta));
  return hydrate(
    await pb.collection(COLLECTION).update<EvidenceRecord>(id, form),
  );
};

/** Where the row sits in the reading. See `src/evidence/order.ts` for the key
 *  itself: only the moved row is written, whatever the list is doing. */
export const setEvidenceSort = async (
  id: string,
  sort: number,
): Promise<EvidenceRecord> =>
  hydrate(await pb.collection(COLLECTION).update<EvidenceRecord>(id, { sort }));

export const deleteEvidence = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// `created` makes the order total, so equal-`sort` rows cannot reshuffle.
// `requestKey: null` opts out of the SDK's auto-cancel: opening a spot and a
// realtime reload can ask at the same moment.
export const listSpotEvidence = async (
  spotId: string,
): Promise<EvidenceRecord[]> =>
  (
    await pb.collection(COLLECTION).getFullList<EvidenceRecord>({
      filter: pb.filter('spot = {:spot}', { spot: spotId }),
      sort: 'sort,created',
      requestKey: null,
    })
  ).map(hydrate);

/** `thumb` takes the sizes declared in the migration; omit it for the original.
 *  Synchronous: the file field is not `protected`, so there is no file token to
 *  fetch first. Empty string for a row whose render has not landed. */
export const evidenceFileUrl = (
  rec: EvidenceRecord,
  thumb?: '200x200' | '800x0',
): string => (rec.file ? pb.files.getURL(rec, rec.file, { thumb }) : '');

export const subscribeEvidence = (
  handler: (action: string, record: EvidenceRecord) => void,
): (() => void) => {
  const pending = pb
    .collection(COLLECTION)
    .subscribe<EvidenceRecord>('*', (e) => handler(e.action, hydrate(e.record)));
  return () => {
    void pending.then((unsubscribe) => unsubscribe()).catch(() => {});
  };
};
