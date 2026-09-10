import { pb } from './pocketbase';

// Bilder attached to a lokalitet: kept LiDAR extracts, map screenshots,
// and plain uploads. Visibility follows the parent lokalitet via the
// collection rules, and the file field is *protected* — image bytes are
// only served with a short-lived file token (see getAttachmentUrl).
// Keep in sync with the attachments.kind select values in the PocketBase
// migrations (1700000300 adds 'flyfoto').
export type AttachmentKind = 'extract' | 'screenshot' | 'upload' | 'flyfoto';

// Free-form; extracts store sourceKey/sourceLabel/style/metresPerPx/
// bbox25833 so the gallery can say what an image shows. Flyfoto stores
// source label + metresPerPx + bbox25833.
export type AttachmentMeta = Record<string, unknown>;

export type AttachmentRecord = {
  id: string;
  locality: string;
  owner: string;
  kind: AttachmentKind;
  // Server-side filename within the record's storage dir.
  file: string;
  caption: string;
  meta: AttachmentMeta | null;
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
};

const COLLECTION = 'attachments';

export const listLocalityAttachments = async (
  localityId: string,
): Promise<AttachmentRecord[]> => {
  return pb.collection(COLLECTION).getFullList<AttachmentRecord>({
    filter: pb.filter('locality = {:lid}', { lid: localityId }),
    sort: '-created',
    // The list reloads on every realtime event, so two of these are
    // regularly in flight at once. The SDK's auto-cancellation would abort
    // the older one and reject its promise; the caller sequences results
    // itself (useLocalityContent), so let both finish.
    requestKey: null,
  });
};

// Bilder per lokalitet for the "Mine lokaliteter" list — see
// countFindsByLocality; same `fields` trick, same reason.
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
  form.append('file', blob, filename);
  return pb.collection(COLLECTION).create<AttachmentRecord>(form);
};

export const updateAttachmentCaption = async (
  id: string,
  caption: string,
): Promise<AttachmentRecord> => {
  return pb.collection(COLLECTION).update<AttachmentRecord>(id, { caption });
};

export const deleteAttachment = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// PB file tokens are valid ~2 minutes; cache one and refresh early so a
// gallery of thumbnails costs a single token request, not one each.
//
// The cache holds the *promise*, not the resolved token, and that is
// load-bearing: a grid mounts all its thumbnails in the same tick, so
// caching only the result still lets N requests leave before the first one
// answers — and the SDK auto-cancels same-key requests, so N-1 of them
// reject and those thumbnails spin forever. `requestKey: null` covers the
// remaining window, where an entry expires while its request is still out.
let fileToken: { token: Promise<string>; fetchedAt: number } | null = null;
const FILE_TOKEN_MAX_AGE_MS = 100000;

const getFileToken = (): Promise<string> => {
  const now = Date.now();
  if (fileToken && now - fileToken.fetchedAt <= FILE_TOKEN_MAX_AGE_MS) {
    return fileToken.token;
  }
  // Annotated because the catch handler refers back to `pending`, which
  // would otherwise be a circular type inference.
  const pending: Promise<string> = pb.files
    .getToken({ requestKey: null })
    .catch((e) => {
      // A failure must not sit in the cache for the next 100 seconds of
      // thumbnails — drop it so the next caller retries.
      if (fileToken?.token === pending) fileToken = null;
      throw e;
    });
  fileToken = { token: pending, fetchedAt: now };
  return pending;
};

// Tokened URL for a protected attachment file. `thumb` takes the sizes
// declared in the migration ('200x200' grid thumb, '800x0' preview);
// omit it for the original.
export const getAttachmentUrl = async (
  rec: AttachmentRecord,
  thumb?: '200x200' | '800x0',
): Promise<string> => {
  const token = await getFileToken();
  return pb.files.getURL(rec, rec.file, { token, thumb });
};

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
