import { pb } from './pocketbase';

const COLLECTION = 'evidence';

export type EvidenceKind = 'lidar' | 'terrain' | 'flyfoto' | 'sunloop' | 'rvt';

export type EvidenceMeta = Record<string, unknown>;

export type EvidenceRecord = {
  id: string;
  spot: string;
  owner: string;
  kind: EvidenceKind;
  file: string;
  caption: string;
  meta: EvidenceMeta | null;
  sort: number;
  created: string;
  updated: string;
  collectionId?: string;
  collectionName?: string;
};

type NewEvidenceInput = {
  spot: string;
  kind: EvidenceKind;
  caption?: string;
  meta?: EvidenceMeta;
};

const nextEvidenceSort = () => Date.now();

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

export const setEvidenceSort = async (
  id: string,
  sort: number,
): Promise<EvidenceRecord> =>
  hydrate(await pb.collection(COLLECTION).update<EvidenceRecord>(id, { sort }));

export const deleteEvidence = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

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

export const evidenceFileUrl = (
  rec: EvidenceRecord,
  thumb?: '200x200' | '800x0',
): string => (rec.file ? pb.files.getURL(rec, rec.file, { thumb }) : '');

export const subscribeEvidence = (
  handler: (action: string, record: EvidenceRecord) => void,
): (() => void) => {
  const pending = pb
    .collection(COLLECTION)
    .subscribe<EvidenceRecord>('*', (e) =>
      handler(e.action, hydrate(e.record)),
    );
  return () => {
    void pending.then((unsubscribe) => unsubscribe()).catch(() => {});
  };
};
