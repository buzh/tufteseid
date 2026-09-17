import { pb } from './pocketbase';

// Match the PB select options; localise via `localities.visibility.*`.
export type LocalityVisibility = 'private' | 'limited' | 'public';

// EPSG:4326.
export type LocalityBbox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

export type LocalityRecord = {
  id: string;
  owner: string;
  // The share link's key: six Crockford base32 characters, unique, write-once.
  code: string;
  name: string;
  description: string;
  // Pre-filled from GeoNorge at creation and freely editable after; optional
  // because pre-migration records carry no such key.
  place?: string;
  municipality?: string;
  matrikkel?: string;
  visibility: LocalityVisibility;
  bbox: LocalityBbox;
  // Forked from. Uncascaded, so a fork outlives its original, and the label
  // denormalizes name and owner so the attribution survives its deletion.
  derivedFrom?: string;
  derivedFromLabel?: string;
  created: string;
  updated: string;
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
  derivedFrom?: string;
  derivedFromLabel?: string;
};

const COLLECTION = 'localities';

// Everything the caller may see; PB enforces the list rule server-side.
export const listLocalities = async (): Promise<LocalityRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityRecord>({
    sort: '-updated',
    expand: 'owner',
  });
};

// "Mine lokaliteter" — an admin's own records, apart from listLocalities.
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

// Uppercased because SQLite's `=` on text does not case-fold. A miss and a
// record the reader may not see are the same error on purpose: saying which
// is a leak.
export const getLocalityByCode = async (
  code: string,
): Promise<LocalityRecord> => {
  return pb
    .collection(COLLECTION)
    .getFirstListItem<LocalityRecord>(
      pb.filter('code = {:code}', { code: code.toUpperCase() }),
      // A deep link asks twice (guest miss, then the retry after sign-in) and
      // an auto-cancelled first lands in the same catch as a genuine miss.
      { expand: 'owner', requestKey: null },
    );
};

// Crockford base32, so a code can be read aloud; 32 divides 256, so `% 32`
// on a random byte is unbiased.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const newLocalityCode = (): string => {
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
    ...(input.derivedFrom
      ? {
          derivedFrom: input.derivedFrom,
          derivedFromLabel: input.derivedFromLabel ?? '',
        }
      : {}),
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
