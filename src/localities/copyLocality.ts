/*
 * `Lag min kopi`: the rectangle, the details, the funn and the Views — not the
 * Files, which would be megabytes down and back up per image and are instead
 * taken one at a time with `Ta med`. Not a transaction: everything here makes
 * records nobody else can see yet, and a half-finished copy can be deleted.
 */

import {
  type AttachmentMeta,
  type AttachmentRecord,
  createAttachmentSpec,
  updateAttachment,
} from '../api/attachments';
import {
  createLocality,
  type LocalityRecord,
  type NewLocalityInput,
} from '../api/localities';
import {
  createLocalityFind,
  type LocalityFindRecord,
} from '../api/localityFinds';
import { upsertLocalityOnLayer } from './localityLayer';
import { remapSceneMeta } from './sceneSpec';
import { viewSpecOf } from './viewSpec';

export type CopyProgress = {
  stage: 'finds' | 'bilder';
  done: number;
  total: number;
};

export type CopyResult = {
  rec: LocalityRecord;
  /** Child rows that did not land. The copy exists either way. */
  failed: number;
};

// Denormalized rather than read through `derivedFrom`, which does not cascade:
// a deleted original still has to leave the copy able to say where it came from.
const derivedLabel = (source: LocalityRecord): string => {
  const owner = source.expand?.owner?.name;
  const name = source.name || source.code;
  return owner ? `${name} (${owner})` : name;
};

// Minus what only a pin knows. `bbox25833` stays, because the queue renders
// the spec's rectangle and a sub-rectangle extract would come back full-size;
// `imageRect` and `renderedAt` describe a figure that does not exist yet.
const specMetaOf = (meta: AttachmentMeta | null): AttachmentMeta => {
  const rest: AttachmentMeta = { ...(meta ?? {}) };
  delete rest.imageRect;
  delete rest.renderedAt;
  return rest;
};

export const copyLocality = async ({
  source,
  finds,
  attachments,
  userId,
  onProgress,
}: {
  source: LocalityRecord;
  finds: LocalityFindRecord[];
  attachments: AttachmentRecord[];
  userId: string;
  onProgress: (progress: CopyProgress) => void;
}): Promise<CopyResult | null> => {
  const views = attachments.filter((rec) => viewSpecOf(rec) != null);

  const input: NewLocalityInput = {
    // Not stamped "(kopi)": that this is a copy is in `derivedFrom`.
    name: source.name,
    description: source.description,
    place: source.place,
    municipality: source.municipality,
    matrikkel: source.matrikkel,
    // Never inherited: a copy must not republish somebody else's reading.
    visibility: 'private',
    bbox: source.bbox,
    derivedFrom: source.id,
    derivedFromLabel: derivedLabel(source),
  };

  let rec: LocalityRecord;
  try {
    rec = await createLocality(input, userId);
  } catch (e) {
    console.warn('[copyLocality] create failed', e);
    return null;
  }
  upsertLocalityOnLayer(rec);

  let failed = 0;

  // The original's ids → the copy's. What cannot be translated is dropped.
  const copiedId = new Map<string, string>();

  onProgress({ stage: 'finds', done: 0, total: finds.length });
  for (let i = 0; i < finds.length; i++) {
    const f = finds[i];
    try {
      const made = await createLocalityFind(
        {
          locality: rec.id,
          title: f.title,
          note: f.note,
          status: f.status,
          geometry: f.geometry,
        },
        userId,
      );
      copiedId.set(f.id, made.id);
    } catch (e) {
      console.warn('[copyLocality] find failed', f.id, e);
      failed++;
    }
    onProgress({ stage: 'finds', done: i + 1, total: finds.length });
  }

  onProgress({ stage: 'bilder', done: 0, total: views.length });
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    try {
      const made = await createAttachmentSpec(
        {
          locality: rec.id,
          kind: v.kind,
          caption: v.caption,
          meta: specMetaOf(v.meta),
          // Epoch ms from before the copy existed, so later keeps land after.
          sort: v.sort,
          hidden: v.hidden,
        },
        userId,
      );
      copiedId.set(v.id, made.id);
    } catch (e) {
      console.warn('[copyLocality] view failed', v.id, e);
      failed++;
    }
    onProgress({ stage: 'bilder', done: i + 1, total: views.length });
  }

  /*
   * A second pass, because a sketch may be a layer on a bilde further down the
   * same list. Every View goes through it, not just those carrying `over`:
   * `funn` is on every kind. A scene needs more, its membership being in
   * `meta.layers` as well. A failure here is not counted — the record arrived.
   */
  for (const v of views) {
    const id = copiedId.get(v.id);
    if (!id) continue;
    const translate = (ids: string[] | undefined) =>
      (ids ?? [])
        .map((x) => copiedId.get(x))
        .filter((x): x is string => x != null);
    const funn = translate(v.funn);
    const over = translate(v.over);
    const meta =
      v.kind === 'scene' && v.meta
        ? remapSceneMeta(specMetaOf(v.meta), (x) => copiedId.get(x) ?? null)
        : null;
    if (funn.length === 0 && over.length === 0 && !meta) continue;
    try {
      await updateAttachment(id, { funn, over, ...(meta ? { meta } : {}) });
    } catch (e) {
      console.warn('[copyLocality] relations failed', v.id, e);
    }
  }

  return { rec, failed };
};
