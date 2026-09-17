import { pb } from './pocketbase';

// Must match the attachments.kind select values in the PB migrations.
export type AttachmentKind =
  | 'extract'
  | 'screenshot'
  | 'upload'
  | 'flyfoto'
  | 'sketch'
  | 'scene';

// Free-form per kind; server-side ceiling is 2 MB.
export type AttachmentMeta = Record<string, unknown>;

export type AttachmentRecord = {
  id: string;
  locality: string;
  owner: string;
  kind: AttachmentKind;
  // Empty until the pixels exist: a View is its `meta` first and is pinned
  // later. Test with `isPinned` (localities/viewSpec.ts), not against ''.
  file: string;
  caption: string;
  meta: AttachmentMeta | null;
  // Opaque ordering key, not an index — see `nextAttachmentSort` below.
  sort: number;
  hidden: boolean;
  // Neither relation cascades, so a dangling id must read as "none" — read
  // them through funnGroups.ts, and through `?? []` for pre-1700000700 rows.
  funn: string[];
  over: string[];
  created: string;
  updated: string;
  // Set by PB on fetched records; pb.files.getURL needs one of them.
  collectionId?: string;
  collectionName?: string;
};

export type NewAttachmentInput = {
  locality: string;
  kind: AttachmentKind;
  caption?: string;
  meta?: AttachmentMeta;
  // Only the copy passes these; every other producer takes the defaults.
  sort?: number;
  hidden?: boolean;
  funn?: string[];
  over?: string[];
};

const COLLECTION = 'attachments';

// Epoch milliseconds, so a producer that does not hold the list still lands
// last. Reordering writes values between neighbours; legacy records carry 0.
const nextAttachmentSort = () => Date.now();

export const listLocalityAttachments = async (
  localityId: string,
): Promise<AttachmentRecord[]> => {
  return pb.collection(COLLECTION).getFullList<AttachmentRecord>({
    filter: pb.filter('locality = {:lid}', { lid: localityId }),
    // `created` makes the order total, so equal-`sort` rows cannot reshuffle.
    sort: 'sort,created',
    // Two of these fly at once on a realtime reload; the SDK would cancel one.
    requestKey: null,
  });
};

// By id, in one request; `requestKey: null` so two callers do not cancel each
// other.
export const listAttachmentsByIds = async (
  ids: readonly string[],
): Promise<AttachmentRecord[]> => {
  if (ids.length === 0) return [];
  const params: Record<string, string> = {};
  const clauses = ids.map((id, i) => {
    params[`id${i}`] = id;
    return `id = {:id${i}}`;
  });
  return pb.collection(COLLECTION).getFullList<AttachmentRecord>({
    filter: pb.filter(clauses.join(' || '), params),
    requestKey: null,
  });
};

export const countAttachmentsByLocality = async (): Promise<
  Map<string, number>
> => {
  const rows = await pb
    .collection(COLLECTION)
    .getFullList<{ locality: string }>({ fields: 'locality' });
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.locality, (counts.get(row.locality) ?? 0) + 1);
  }
  return counts;
};

// A row that arrives with its pixels in hand; a View goes through
// `createAttachmentSpec` instead.
export const createAttachment = async (
  input: NewAttachmentInput,
  ownerId: string,
  blob: Blob,
  filename: string,
): Promise<AttachmentRecord> => {
  const form = new FormData();
  form.append('locality', input.locality);
  form.append('owner', ownerId);
  form.append('kind', input.kind);
  form.append('caption', input.caption ?? '');
  if (input.meta) form.append('meta', JSON.stringify(input.meta));
  form.append('sort', String(input.sort ?? nextAttachmentSort()));
  if (input.hidden) form.append('hidden', 'true');
  // Multiple relations go up one value per key in multipart.
  for (const id of input.funn ?? []) form.append('funn', id);
  for (const id of input.over ?? []) form.append('over', id);
  form.append('file', blob, filename);
  return pb.collection(COLLECTION).create<AttachmentRecord>(form);
};

// A View: the parameters, with no pixels yet — the pin queue renders them.
export const createAttachmentSpec = async (
  input: NewAttachmentInput,
  ownerId: string,
): Promise<AttachmentRecord> =>
  pb.collection(COLLECTION).create<AttachmentRecord>({
    locality: input.locality,
    owner: ownerId,
    kind: input.kind,
    caption: input.caption ?? '',
    meta: input.meta ?? {},
    sort: input.sort ?? nextAttachmentSort(),
    hidden: input.hidden ?? false,
    funn: input.funn ?? [],
    over: input.over ?? [],
  });

// The pixels for an existing spec. `meta` goes up in the same request so a
// record can never hold a file its meta does not describe; pass the whole of
// it, since PocketBase replaces a JSON field wholesale.
export const pinAttachment = async (
  id: string,
  blob: Blob,
  filename: string,
  meta: AttachmentMeta,
): Promise<AttachmentRecord> => {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('meta', JSON.stringify(meta));
  return pb.collection(COLLECTION).update<AttachmentRecord>(id, form);
};

export const updateAttachment = async (
  id: string,
  patch: {
    caption?: string;
    sort?: number;
    hidden?: boolean;
    // Replaced wholesale — PocketBase has no JSON merge.
    meta?: AttachmentMeta;
    funn?: string[];
    over?: string[];
  },
): Promise<AttachmentRecord> => {
  return pb.collection(COLLECTION).update<AttachmentRecord>(id, patch);
};

export const deleteAttachment = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// `thumb` takes the sizes declared in the migration; omit it for the original.
// Synchronous: the file field is not `protected`, so there is no file token.
export const getAttachmentUrl = (
  rec: AttachmentRecord,
  thumb?: '200x200' | '800x0',
): string => pb.files.getURL(rec, rec.file, { thumb });

export const subscribeAttachments = (
  handler: (
    action: 'create' | 'update' | 'delete',
    rec: AttachmentRecord,
  ) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<AttachmentRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
