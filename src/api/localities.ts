import { pb } from './pocketbase';

// Visibility mirrors the enum in the `localities` collection. String
// values match the PB select options exactly — do not translate for
// display (localise via i18n keys under `localities.visibility.*`).
export type LocalityVisibility = 'private' | 'limited' | 'public';

// The authored rectangle in EPSG:4326 — created by a box drag, movable
// and resizable afterwards. Not derived from the lokalitet's content.
export type LocalityBbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

export type LocalityRecord = {
  id: string;
  owner: string;
  // Six characters of Crockford base32, unique across the install. The
  // short code on the lokalitet row: what you read down a phone or cite in
  // a report. Generated at create (below) and never rewritten, so it
  // survives a rename and a "Juster området" — which is the entire reason
  // it is not derived from the id, the name or the bbox.
  code: string;
  name: string;
  description: string;
  // Where it is, as three editable strings. Pre-filled at creation from
  // GeoNorge (src/localities/localityContext.ts) and the user's afterwards
  // — nothing downstream parses them, so a correction is always safe.
  // Optional on the type because records created before the migration have
  // no such keys until PocketBase next writes them.
  place?: string;
  municipality?: string;
  matrikkel?: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
  created: string;
  updated: string;
  // PB's `expand` output when we ?expand=owner.
  expand?: {
    owner?: { id: string; name: string; avatar: string };
  };
};

export type NewLocalityInput = {
  name: string;
  description?: string;
  place?: string;
  municipality?: string;
  matrikkel?: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
};

const COLLECTION = 'localities';

// Everything the current auth principal may see — PB enforces the list
// rule server-side. Full list, not a single page: localities are small
// rows (no geometry blob) and the map wants all rectangles anyway.
export const listLocalities = async (): Promise<LocalityRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityRecord>({
    sort: '-updated',
    expand: 'owner',
  });
};

// "Mine lokaliteter" — the admin's own records stay separate from the
// everything-view listLocalities gives them.
export const listMyLocalities = async (
  userId: string,
): Promise<LocalityRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityRecord>({
    filter: pb.filter('owner = {:uid}', { uid: userId }),
    sort: '-updated',
  });
};

export const getLocality = async (id: string): Promise<LocalityRecord> => {
  return pb
    .collection(COLLECTION)
    .getOne<LocalityRecord>(id, { expand: 'owner' });
};

// Crockford base32: the digits and the consonants, minus I, L, O and U, so
// a code can be read aloud without being spelled out. Exactly 32 symbols,
// and a byte is exactly eight of those, so `% 32` is uniform — no rejection
// sampling and no modulo bias.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const newLocalityCode = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % 32];
  return code;
};

// PB reports a unique-index violation as a 400 with a per-field entry in
// `response.data`. Our field is *called* `code`, and PB's own name for the
// error string is also `code`, hence `data.code.code` — the second one is
// the error kind, not the value we sent.
const isCodeTaken = (err: unknown): boolean =>
  (err as { response?: { data?: Record<string, { code?: string }> } })?.response
    ?.data?.code?.code === 'validation_not_unique';

// 32^6 is about 1.07 billion, so at this scale a second draw is already an
// event nobody will see; the unique index is what makes "no collisions" a
// fact instead of a hope, and this loop is what keeps that fact from
// surfacing to the user as a failed "Ny lokalitet".
const CODE_ATTEMPTS = 2;

export const createLocality = async (
  input: NewLocalityInput,
  ownerId: string,
): Promise<LocalityRecord> => {
  const record = {
    owner: ownerId,
    name: input.name,
    description: input.description ?? '',
    place: input.place ?? '',
    municipality: input.municipality ?? '',
    matrikkel: input.matrikkel ?? '',
    visibility: input.visibility,
    bbox: input.bbox,
  };

  for (let attempt = 1; ; attempt++) {
    try {
      return await pb
        .collection(COLLECTION)
        .create<LocalityRecord>(
          { ...record, code: newLocalityCode() },
          { expand: 'owner' },
        );
    } catch (err) {
      if (attempt >= CODE_ATTEMPTS || !isCodeTaken(err)) throw err;
    }
  }
};

export type LocalityPatch = Partial<{
  name: string;
  description: string;
  place: string;
  municipality: string;
  matrikkel: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
}>;

export const updateLocality = async (
  id: string,
  patch: LocalityPatch,
): Promise<LocalityRecord> => {
  return pb
    .collection(COLLECTION)
    .update<LocalityRecord>(id, patch, { expand: 'owner' });
};

export const deleteLocality = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// Realtime — emits on create/update/delete for any record the user is
// allowed to see. Returns the unsubscribe fn.
export const subscribeLocalities = (
  handler: (
    action: 'create' | 'update' | 'delete',
    rec: LocalityRecord,
  ) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<LocalityRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
