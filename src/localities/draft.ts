import type { FeatureCollection } from 'geojson';
import type { AttachmentKind, AttachmentRecord } from '../api/attachments';
import type { LocalityPatch, LocalityRecord } from '../api/localities';
import type {
  LocalityFindRecord,
  LocalityFindStatus,
} from '../api/localityFinds';

/*
 * The edit buffer (docs/lokalitet-view.md §5.6).
 *
 * Edit is a transaction: `Lagre` writes, `Avbryt` throws away, and nothing in
 * between touches the server. PocketBase has no multi-record transaction over
 * HTTP, so a commit is N writes whatever we do — the question this module
 * answers is only *when* they happen, and the answer is "at the end, all at
 * once, or never".
 *
 * **This is a delta, not a snapshot**, and that is what keeps it small enough
 * to live in `localStorage`. It records what the session has *changed*: a
 * patch per touched record, a full body per record it invented, a tombstone
 * per record it removed. Everything untouched stays where it is — in the two
 * lists the workspace loads from PocketBase — and `overlayFinds` /
 * `overlayAttachments` lay the delta over them for the surfaces to read.
 *
 * The one thing that is not a delta is `baseLocality`: the lokalitet's own
 * fields are edited *through* `activeLocalityAtom`, because half the app
 * reads the rectangle off it (Terreng's DEM, the kulturminner query, every
 * producer's bbox25833) and a buffered rectangle that those did not see would
 * make "Juster området refetches the DEM for free" stop being true. So the
 * atom holds the edited record and the draft holds the copy to put back.
 *
 * What makes all of this affordable is §4.1.2: a kept extract is a **spec**,
 * a few hundred bytes of JSON, not a few megabytes of PNG. Twelve of them
 * buffer in four kilobytes. The two kinds that are genuinely bytes — a
 * screenshot and an upload — are written eagerly and *compensated* on
 * `Avbryt`, which is what `eagerIds` is for.
 */

/** The lokalitet's own buffered fields — exactly `LocalityPatch`'s set. */
export type DraftLocality = Required<
  Pick<LocalityPatch, 'name' | 'description' | 'visibility' | 'bbox'>
> &
  Pick<LocalityPatch, 'place' | 'municipality' | 'matrikkel'>;

/** What a funn's row in the buffer holds — the four editable columns. */
export type DraftFind = {
  title: string;
  note: string;
  status: LocalityFindStatus;
  geometry: FeatureCollection;
};

/** …and an attachment's — the three curation columns. */
export type DraftAttachment = {
  caption: string;
  sort: number;
  hidden: boolean;
};

/** A View kept during the session: a spec, with no pixels behind it yet. */
export type DraftSpec = DraftAttachment & {
  kind: AttachmentKind;
  meta: Record<string, unknown>;
  /**
   * The exhibit position it was minted with, so the commit can tell an
   * arranged spec from an untouched one. PocketBase mints its own `sort` on
   * create (`nextAttachmentSort`) and that value is the better one for a
   * record being created *now* — so the buffered position is only worth a
   * second request when the author has actually moved or hidden the card.
   */
  bornSort: number;
};

export type LocalityDraft = {
  /** Bumped whenever the shape below changes; a stored older one is dropped. */
  version: 2;
  localityId: string;
  startedAt: number;
  /** What `activeLocalityAtom` held when `Rediger` was pressed. */
  baseLocality: DraftLocality;
  /** …and what it holds now, so a recovered draft can put the edits back. */
  locality: DraftLocality;
  /** Edited existing funn, by real id. */
  finds: Record<string, DraftFind>;
  /** Funn invented this session, by temp id. */
  newFinds: Record<string, DraftFind>;
  findDeletes: string[];
  /** Edited existing bilder, by real id. */
  attachments: Record<string, DraftAttachment>;
  /** Views kept this session, by temp id. */
  newSpecs: Record<string, DraftSpec>;
  attachmentDeletes: string[];
  /**
   * Files written straight through — a screenshot, an upload, a kept picker
   * proposal. They are bytes, so there is nothing to buffer; `Avbryt` deletes
   * them instead. The compensating edge §5.6 admits to, and it is narrow on
   * purpose: nobody produces twelve of these in a session.
   */
  eagerIds: string[];
};

const TEMP_PREFIX = 'draft:';

/**
 * Whether an id belongs to something that only exists in the buffer.
 *
 * The surfaces need this because a buffered record is a perfectly ordinary
 * card in every way but one: there is nothing on the server to fetch, pin or
 * download, so the three verbs that reach past the record are absent on it.
 */
export const isDraftId = (id: string): boolean => id.startsWith(TEMP_PREFIX);

export const localityFieldsOf = (rec: LocalityRecord): DraftLocality => ({
  name: rec.name,
  description: rec.description,
  place: rec.place,
  municipality: rec.municipality,
  matrikkel: rec.matrikkel,
  visibility: rec.visibility,
  bbox: rec.bbox,
});

export const newDraft = (locality: LocalityRecord): LocalityDraft => {
  const fields = localityFieldsOf(locality);
  return {
    version: 2,
    localityId: locality.id,
    startedAt: Date.now(),
    baseLocality: fields,
    locality: fields,
    finds: {},
    newFinds: {},
    findDeletes: [],
    attachments: {},
    newSpecs: {},
    attachmentDeletes: [],
    eagerIds: [],
  };
};

/*
 * Temp ids.
 *
 * Minted from a module counter rather than a field on the draft, because the
 * caller needs the id *before* the state update that uses it — a funn is
 * bound to the pen the moment its first shape closes, and reading a value
 * back out of a `setState` updater is the one thing React asks you not to do.
 *
 * The timestamp is what makes that safe across a recovery: a buffer restored
 * from `localStorage` carries ids minted by a previous page load, and a bare
 * counter would start again at one and collide with them.
 */
let mintCounter = 0;
const mintRun = Date.now().toString(36);

export const mintDraftId = (): string =>
  `${TEMP_PREFIX}${mintRun}.${(mintCounter++).toString(36)}`;

/*
 * The writes, as pure functions of the buffer.
 *
 * Every one of them is a `mutate(fn)` argument in the workspace. They live
 * here rather than inline there for the same reason the overlays do: whether
 * editing a funn means "patch the existing row" or "rewrite the invented
 * body" is a fact about the buffer's shape, and the twenty call sites should
 * not each have to know it.
 */

/*
 * The record as the buffer would have written it, for the `base` argument
 * below. A patch has to be stored whole rather than as the one field that
 * changed, because a session that retitles a funn and then deletes it and
 * then takes the deletion back has to get *its* title, not the server's —
 * and the only copy of the rest of the fields at that point is this.
 */
export const findBaseOf = (rec: LocalityFindRecord): DraftFind => ({
  title: rec.title,
  note: rec.note,
  status: rec.status,
  geometry: rec.geometry,
});

export const attachmentBaseOf = (rec: AttachmentRecord): DraftAttachment => ({
  caption: rec.caption,
  sort: rec.sort,
  hidden: rec.hidden,
});

const isNew = (d: LocalityDraft, id: string) => id in d.newFinds;

/** Patch a funn — into `newFinds` if this session invented it. */
export const withFind = (
  d: LocalityDraft,
  id: string,
  base: DraftFind,
  patch: Partial<DraftFind>,
): LocalityDraft =>
  isNew(d, id)
    ? {
        ...d,
        newFinds: { ...d.newFinds, [id]: { ...d.newFinds[id], ...patch } },
      }
    : {
        ...d,
        finds: { ...d.finds, [id]: { ...base, ...d.finds[id], ...patch } },
      };

export const withNewFind = (
  d: LocalityDraft,
  id: string,
  body: DraftFind,
): LocalityDraft => ({ ...d, newFinds: { ...d.newFinds, [id]: body } });

/*
 * Remove a funn.
 *
 * One invented this session leaves no trace — there is nothing on the server
 * to tombstone, and a tombstone for a record that never existed would be a
 * DELETE against a 404 at commit. One that does exist gets the tombstone,
 * and keeps its buffered patch: taking the deletion back has to give the
 * record back as the author last left it, not as the server last saw it.
 */
export const dropFind = (d: LocalityDraft, id: string): LocalityDraft => {
  if (isNew(d, id)) {
    const newFinds = { ...d.newFinds };
    delete newFinds[id];
    return { ...d, newFinds };
  }
  if (d.findDeletes.includes(id)) return d;
  return { ...d, findDeletes: [...d.findDeletes, id] };
};

export const withAttachment = (
  d: LocalityDraft,
  id: string,
  base: DraftAttachment,
  patch: Partial<DraftAttachment>,
): LocalityDraft =>
  id in d.newSpecs
    ? {
        ...d,
        newSpecs: { ...d.newSpecs, [id]: { ...d.newSpecs[id], ...patch } },
      }
    : {
        ...d,
        attachments: {
          ...d.attachments,
          [id]: { ...base, ...d.attachments[id], ...patch },
        },
      };

export const withNewSpec = (
  d: LocalityDraft,
  id: string,
  body: DraftSpec,
): LocalityDraft => ({ ...d, newSpecs: { ...d.newSpecs, [id]: body } });

export const dropAttachment = (
  d: LocalityDraft,
  id: string,
): LocalityDraft => {
  if (id in d.newSpecs) {
    const newSpecs = { ...d.newSpecs };
    delete newSpecs[id];
    return { ...d, newSpecs };
  }
  if (d.attachmentDeletes.includes(id)) return d;
  return { ...d, attachmentDeletes: [...d.attachmentDeletes, id] };
};

/** Take a deferred deletion back — the other half of the greyed card. */
export const undelete = (d: LocalityDraft, id: string): LocalityDraft => ({
  ...d,
  findDeletes: d.findDeletes.filter((x) => x !== id),
  attachmentDeletes: d.attachmentDeletes.filter((x) => x !== id),
});

/** A File written straight through, for `Avbryt` to compensate. */
export const withEager = (d: LocalityDraft, id: string): LocalityDraft => ({
  ...d,
  eagerIds: [...d.eagerIds, id],
});

export const withLocality = (
  d: LocalityDraft,
  patch: Partial<DraftLocality>,
): LocalityDraft => ({ ...d, locality: { ...d.locality, ...patch } });

/*
 * Reading the buffer back.
 *
 * Both overlays take the server's list and return what the session has made
 * of it: patched where it patched, plus what it invented — appended, because
 * both lists are already in the order the surfaces want (funn by creation,
 * bilder by `sort`) and a temp record is by definition the newest thing in
 * either.
 *
 * **Deleted records stay in the list**, and that is §5.6's second
 * consequence rather than an oversight. A deletion that will not happen for
 * another twenty minutes is not a deletion yet, and a card that vanished
 * would be claiming otherwise — so the record is still here, the surfaces
 * grey it, and taking it back is one press instead of `Avbryt` and starting
 * the session over. `deletedIds` on the workspace is what the greying reads.
 *
 * The synthesised records are real `LocalityFindRecord` / `AttachmentRecord`
 * shapes rather than a union with a "draft" arm, so no surface downstream has
 * to learn a second type to render a card. `isDraftId` is the only place the
 * difference is visible, and only three verbs consult it.
 */
export const overlayFinds = (
  items: LocalityFindRecord[] | null,
  draft: LocalityDraft | null,
  localityId: string,
  ownerId: string,
): LocalityFindRecord[] | null => {
  if (!draft || !items) return items;
  const out = items.map((it) => {
    const patch = draft.finds[it.id];
    return patch ? { ...it, ...patch } : it;
  });
  for (const [id, body] of Object.entries(draft.newFinds)) {
    out.push({
      id,
      locality: localityId,
      owner: ownerId,
      created: '',
      updated: '',
      ...body,
    });
  }
  return out;
};

export const overlayAttachments = (
  items: AttachmentRecord[] | null,
  draft: LocalityDraft | null,
  localityId: string,
  ownerId: string,
): AttachmentRecord[] | null => {
  if (!draft || !items) return items;
  const out = items.map((it) => {
    const patch = draft.attachments[it.id];
    return patch ? { ...it, ...patch } : it;
  });
  for (const [id, body] of Object.entries(draft.newSpecs)) {
    out.push({
      id,
      locality: localityId,
      owner: ownerId,
      kind: body.kind,
      // A spec has no pixels yet, and `isPinned` reads exactly this.
      file: '',
      caption: body.caption,
      meta: body.meta,
      sort: body.sort,
      hidden: body.hidden,
      created: '',
      updated: '',
    });
  }
  // The buffered ones carry a clock-derived `sort` like every other new
  // record, so one sort puts them where they belong rather than always last.
  return out.sort((a, b) => a.sort - b.sort);
};

/*
 * What `Avbryt` has to name, and what decides whether it asks at all.
 *
 * The confirm counts *work*, not writes: a session that kept twelve views and
 * deleted three funn rolls back with one DELETE, and telling the user it
 * costs nothing would be answering a question they did not ask. So the
 * sentence says how much they are throwing away.
 */
export type DraftCounts = {
  finds: number;
  bilder: number;
  deletions: number;
  locality: boolean;
};

const sameLocality = (a: DraftLocality, b: DraftLocality): boolean =>
  a.name === b.name &&
  a.description === b.description &&
  (a.place ?? '') === (b.place ?? '') &&
  (a.municipality ?? '') === (b.municipality ?? '') &&
  (a.matrikkel ?? '') === (b.matrikkel ?? '') &&
  a.visibility === b.visibility &&
  a.bbox.join(',') === b.bbox.join(',');

export const draftCounts = (d: LocalityDraft): DraftCounts => ({
  finds: Object.keys(d.newFinds).length + Object.keys(d.finds).length,
  bilder:
    Object.keys(d.newSpecs).length +
    Object.keys(d.attachments).length +
    d.eagerIds.length,
  deletions: d.findDeletes.length + d.attachmentDeletes.length,
  locality: !sameLocality(d.baseLocality, d.locality),
});

export const isDirty = (d: LocalityDraft | null): boolean => {
  if (!d) return false;
  const c = draftCounts(d);
  return c.finds > 0 || c.bilder > 0 || c.deletions > 0 || c.locality;
};

/**
 * The lokalitet's own patch, or null when nothing on it moved.
 *
 * Diffed rather than accumulated so that typing a name and typing it back
 * costs no write — which matters more than it sounds, because `Juster
 * området` writes a bbox on every finished gesture and most sessions end
 * where they started.
 */
export const localityPatchOf = (d: LocalityDraft): LocalityPatch | null => {
  if (sameLocality(d.baseLocality, d.locality)) return null;
  const patch: LocalityPatch = {};
  const now = d.locality;
  const base = d.baseLocality;
  if (now.name !== base.name) patch.name = now.name;
  if (now.description !== base.description) patch.description = now.description;
  if ((now.place ?? '') !== (base.place ?? '')) patch.place = now.place ?? '';
  if ((now.municipality ?? '') !== (base.municipality ?? '')) {
    patch.municipality = now.municipality ?? '';
  }
  if ((now.matrikkel ?? '') !== (base.matrikkel ?? '')) {
    patch.matrikkel = now.matrikkel ?? '';
  }
  if (now.visibility !== base.visibility) patch.visibility = now.visibility;
  if (now.bbox.join(',') !== base.bbox.join(',')) patch.bbox = now.bbox;
  return patch;
};

/*
 * Persistence (§5.6, consequence 4).
 *
 * "The draft must survive a crash" — under autosave, closing the tab lost
 * nothing; under a transaction it would lose the session. For an app used
 * outdoors on a phone with a bad connection that is not a nicety, and the
 * View/File split is what makes it possible at all: specs fit in
 * `localStorage`, blobs never would.
 *
 * Keyed on the lokalitet id, one draft each, so two tabs on two different
 * sites do not fight. A write failure is swallowed: a full quota is a reason
 * to lose the recovery copy, not a reason to interrupt the editing.
 */
const KEY_PREFIX = 'tufteseid.draft.';

export const loadDraft = (localityId: string): LocalityDraft | null => {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + localityId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalityDraft;
    if (parsed.version !== 2 || parsed.localityId !== localityId) {
      window.localStorage.removeItem(KEY_PREFIX + localityId);
      return null;
    }
    return isDirty(parsed) ? parsed : null;
  } catch (e) {
    console.warn('[localityDraft] load failed', e);
    return null;
  }
};

export const saveDraft = (d: LocalityDraft): void => {
  try {
    window.localStorage.setItem(KEY_PREFIX + d.localityId, JSON.stringify(d));
  } catch (e) {
    console.warn('[localityDraft] persist failed', e);
  }
};

export const clearDraft = (localityId: string): void => {
  try {
    window.localStorage.removeItem(KEY_PREFIX + localityId);
  } catch {
    // Nothing to do about it and nothing depends on it.
  }
};
