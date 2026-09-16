/*
 * `Lag min kopi` — forking somebody else's lokalitet (docs/lokalitet-view.md
 * §7).
 *
 * **The rectangle, the details, the funn, and the Views. Not the Files.**
 *
 * That line lands exactly where the cost is. Copying a View costs a row of
 * JSON — a few hundred bytes the pin queue turns back into pixels afterwards
 * (§4.1.2) — while copying a File means pulling up to twenty megabytes down
 * and pushing it back up, per image, through the browser of somebody who has
 * so far only expressed interest. So the Views come along and the Files stay
 * where they are, reachable through `derivedFrom` and taken one at a time with
 * `Ta med` by whoever actually wants one.
 *
 * Before the View/File split the copy carried no images at all, on the
 * grounds that extracts are re-derivable and a new lokalitet fetches its own
 * starter set anyway. True, and lossy: which acquisition, which azimuth, which
 * style at which resolution over which sub-rectangle *was* the reading being
 * shared, and a default starter set does not reproduce it.
 *
 * Not a transaction, and it should not be one. Everything here is a create on
 * records nobody else can see yet; a half-finished copy is a lokalitet with
 * some of its funn in it, which is a thing you can look at and finish or
 * delete. A rollback would be the same failure with the evidence thrown away.
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

/** Rank 2 of the banner slot (§5.7), while this is running. */
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

/*
 * The original's name and owner, frozen into a string.
 *
 * Denormalized rather than read through the relation because the relation is
 * `cascadeDelete: false` on purpose: the day the original is deleted is
 * exactly the day the copy still needs to be able to say where it came from.
 * A parenthetical rather than a separator, because the banner wraps this in
 * *"Kopiert fra …"* and "Storevike (Ola Nordmann)" reads as one thing where
 * "Storevike · Ola Nordmann" reads as two columns.
 */
const derivedLabel = (source: LocalityRecord): string => {
  const owner = source.expand?.owner?.name;
  const name = source.name || source.code;
  return owner ? `${name} (${owner})` : name;
};

/*
 * A spec's meta, minus what only a pin knows.
 *
 * `bbox25833` stays: the queue renders the *spec's* rectangle rather than the
 * lokalitet's current one, and a copy that dropped it would re-render a
 * sub-rectangle extract over the whole area. `imageRect` and `renderedAt` are
 * facts about a figure that does not exist yet, and a record carrying the
 * timestamp of pixels it does not have is the one kind of provenance error
 * `src/figure/` exists to prevent.
 */
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
    // Kept, not stamped with "(kopi)" — the same argument as §8.3's
    // auto-naming. A good name is worth keeping, and that this is a copy is a
    // fact the record carries in `derivedFrom` rather than in its title.
    name: source.name,
    description: source.description,
    place: source.place,
    municipality: source.municipality,
    matrikkel: source.matrikkel,
    // Never inherited. Copying a `public` lokalitet would republish somebody
    // else's reading under your name, by default, as a side effect of being
    // interested in it.
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

  /*
   * The original's ids → the copy's, for the relations.
   *
   * A bilde says which funn it belongs to and a sketch or a scene says which
   * bilder it sits over, and those ids mean nothing in a lokalitet that has
   * just minted its own. Left
   * alone they would be relations to somebody else's records — which the
   * create rules refuse anyway — so they are translated, and whatever cannot
   * be translated is dropped: a File stayed with the original (§8.12) and is
   * not in this lokalitet at all until `Ta med` brings it over.
   */
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
          // The arrangement comes too (§4.4). The original's `sort` values
          // are epoch milliseconds from before this copy existed, so they
          // preserve the order among themselves and sit below anything the
          // new owner keeps afterwards — which is exactly right: what you add
          // to a fork lands after what you forked.
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
   * The relations, in a second pass.
   *
   * They cannot go on the create: a sketch may be a layer on a bilde further
   * down the same list, and the copy of that bilde does not exist yet. By here
   * every record that is going to exist does, so one PATCH per record wires
   * the whole graph at once. A failure is not counted — the record itself
   * arrived, and a fork whose overlay lost track of which photograph it was
   * traced off is a smaller loss than one that did not copy.
   *
   * Every View goes through it since step 9, not just the two that carry
   * `over`: `funn` means "which funn this bilde belongs to" now (§13.6), on
   * every kind, and a fork that carried the funn and lost which images were
   * filed under them would arrive with its exhibit unsorted. `over` is still
   * a sketch's and a scene's — what it is drawn on, what it is made of — and
   * the scene needs one thing more, since its membership is in `meta.layers`
   * as well as in `over` and both halves have to name the copy's records or
   * the flatten would be of the original's. A relation that cannot be
   * translated is dropped everywhere, which is the same sentence in three
   * places: the original's Files stayed with the original (§8.12), so a scene
   * built over one arrives with that layer missing until `Ta med` brings the
   * File across — and a File taken across afterwards arrives filed under
   * nothing, because by then there is no map from the original's ids to this
   * fork's.
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
