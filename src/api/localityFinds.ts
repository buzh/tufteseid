import type { FeatureCollection } from 'geojson';
import { pb } from './pocketbase';

// Match the PB select options. Visibility is inherited from the parent
// lokalitet through the collection rules; there is no field for it.
export type LocalityFindStatus =
  | 'mulig'
  | 'sannsynlig'
  | 'avkreftet'
  | 'rapportert';

export type LocalityFindRecord = {
  id: string;
  locality: string;
  owner: string;
  title: string;
  note: string;
  status: LocalityFindStatus;
  // EPSG:4326, always a FeatureCollection: a funn may be several strokes.
  geometry: FeatureCollection;
  created: string;
  updated: string;
};

export type NewLocalityFindInput = {
  locality: string;
  title: string;
  note?: string;
  status?: LocalityFindStatus;
  geometry: FeatureCollection;
};

const COLLECTION = 'finds';

export const listLocalityFinds = async (
  localityId: string,
): Promise<LocalityFindRecord[]> => {
  return pb.collection(COLLECTION).getFullList<LocalityFindRecord>({
    filter: pb.filter('locality = {:lid}', { lid: localityId }),
    sort: 'created',
    // Realtime reloads overlap; a cancelled promise reads as a load failure.
    requestKey: null,
  });
};

// `fields` keeps the GeoJSON out: without it a count pulls every drawing.
export const countFindsByLocality = async (): Promise<Map<string, number>> => {
  const rows = await pb
    .collection(COLLECTION)
    .getFullList<{ locality: string }>({ fields: 'locality' });
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.locality, (counts.get(row.locality) ?? 0) + 1);
  }
  return counts;
};

export const createLocalityFind = async (
  input: NewLocalityFindInput,
  ownerId: string,
): Promise<LocalityFindRecord> => {
  return pb.collection(COLLECTION).create<LocalityFindRecord>({
    locality: input.locality,
    owner: ownerId,
    title: input.title,
    note: input.note ?? '',
    status: input.status ?? 'mulig',
    geometry: input.geometry,
  });
};

export type LocalityFindPatch = Partial<{
  title: string;
  note: string;
  status: LocalityFindStatus;
  geometry: FeatureCollection;
}>;

export const updateLocalityFind = async (
  id: string,
  patch: LocalityFindPatch,
): Promise<LocalityFindRecord> => {
  return pb.collection(COLLECTION).update<LocalityFindRecord>(id, patch);
};

export const deleteLocalityFind = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// Wildcard subscriptions cannot filter server-side here, so consumers check
// `rec.locality` themselves.
export const subscribeLocalityFinds = (
  handler: (
    action: 'create' | 'update' | 'delete',
    rec: LocalityFindRecord,
  ) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<LocalityFindRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
