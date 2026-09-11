import { pb } from './pocketbase';

// Bilder attached to a lokalitet: kept LiDAR extracts, map screenshots,
// and plain uploads. Visibility follows the parent lokalitet via the
// collection rules, and the file field is *protected* — image bytes are
// only served with a short-lived file token (see getAttachmentUrl).
// Keep in sync with the attachments.kind select values in the PocketBase
// migrations (1700000300 adds 'flyfoto').
export type AttachmentKind = 'extract' | 'screenshot' | 'upload' | 'flyfoto';

// Free-form; extracts store sourceKey/sourceLabel/style/metresPerPx/
// bbox25833 so the strip can say what an image shows. Flyfoto stores
// source label + metresPerPx + bbox25833.
export type AttachmentMeta = Record<string, unknown>;

export type AttachmentRecord = {
  id: string;
  locality: string;
  owner: string;
  kind: AttachmentKind;
  // Server-side filename within the record's storage dir, and **empty until
  // the pixels exist** (docs/lokalitet-view.md §4.1.2). A View — an extract, a
  // terrain render, a flyfoto — is kept as its `meta` first and materialised
  // by the pin queue afterwards, so an empty string here is a normal state
  // rather than a broken record. `isPinned` in localities/viewSpec.ts is the
  // predicate; nothing should compare this to '' by hand.
  file: string;
  caption: string;
  meta: AttachmentMeta | null;
  // Exhibit order and concealment — docs/lokalitet-view.md §4.4. `sort` is an
  // opaque ordering key, not an index: see `nextAttachmentSort` below.
  sort: number;
  hidden: boolean;
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

/*
 * The sort key a newly created bilde gets: epoch milliseconds.
 *
 * An opaque ordering key rather than a 0..n index, and that is what lets the
 * producers that do *not* hold the attachment list — terrain `Lagre`, the
 * extract's `Behold` — land their image at the end of the exhibit without
 * asking anybody what the end currently is. It is minted here rather than by
 * the caller for exactly that reason: "later than everything that already
 * exists" is a fact a clock knows and a caller would have to look up.
 *
 * Reordering rewrites the moved record to a value *between* its new
 * neighbours (`useLocalityWorkspace.reorderBilde`), so a drag costs one PATCH
 * rather than one per card. Those values are small — a renumbering pass uses
 * multiples of 1000 — which keeps them below any future clock reading, so an
 * image created after a reorder still arrives last.
 *
 * Records written before this field existed carry 0 and sort first, in
 * creation order, which is the order they were displayed in anyway.
 */
const nextAttachmentSort = () => Date.now();

export const listLocalityAttachments = async (
  localityId: string,
): Promise<AttachmentRecord[]> => {
  return pb.collection(COLLECTION).getFullList<AttachmentRecord>({
    filter: pb.filter('locality = {:lid}', { lid: localityId }),
    // Exhibit order, oldest first — the sequence the author arranged, not the
    // newest-first inventory this was before §4.4. `created` breaks the ties
    // that legacy zeroes and same-millisecond batches leave behind, and it is
    // what makes the order total: without it PocketBase is free to return two
    // equal-`sort` rows in either order, and a rail that reshuffles itself on
    // every realtime event is worse than no order at all.
    sort: 'sort,created',
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

/** A File: bytes, and there is no other way to have them (§4.1.1). */
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
  form.append('sort', String(nextAttachmentSort()));
  form.append('file', blob, filename);
  return pb.collection(COLLECTION).create<AttachmentRecord>(form);
};

/*
 * A View: the row of parameters, with no pixels yet (§4.1.2).
 *
 * This is how `Behold`, the starter set and the terrain tool's own `Lagre`
 * write. A few hundred bytes of JSON instead of up to twenty megabytes of
 * PNG, which is what makes keeping an image free — and free keeps are what a
 * carousel you triage in, and a picker you throw eight of twelve away in, both
 * need in order to be reasonable things to put in front of someone.
 *
 * Plain JSON rather than the FormData above, deliberately: a multipart create
 * with no file part is the same request said in a way that invites somebody to
 * add one later.
 */
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
    sort: nextAttachmentSort(),
  });

/*
 * …and the pin: the pixels for a spec that already exists.
 *
 * `meta` goes up with the file because materialising a View is what learns the
 * three things the spec could not know — where the image sits inside the
 * figure (`imageRect`), what resolution the source actually gave
 * (`metresPerPx`) and when the pixels were made (`renderedAt`). One request,
 * so a record can never hold a file the meta does not describe.
 *
 * The caller passes the *whole* meta, not a patch: PocketBase replaces a JSON
 * field wholesale.
 */
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

/** Caption, exhibit position or concealment — everything an author edits. */
export const updateAttachment = async (
  id: string,
  patch: { caption?: string; sort?: number; hidden?: boolean },
): Promise<AttachmentRecord> => {
  return pb.collection(COLLECTION).update<AttachmentRecord>(id, patch);
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
