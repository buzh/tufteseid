import type { FeatureCollection } from 'geojson';
import type { AttachmentKind, AttachmentRecord } from '../api/attachments';
import type { LocalityPatch, LocalityRecord } from '../api/localities';
import type {
  LocalityFindRecord,
  LocalityFindStatus,
} from '../api/localityFinds';

// The edit buffer. Edit is a transaction: `Lagre` writes, `Avbryt` throws
// away, nothing in between touches the server.
//
// A delta, not a snapshot — a patch per touched record, a body per invented
// one, a tombstone per removed one — which is what keeps it small enough for
// `localStorage`. The overlays below lay it over the server's lists.
//
// `baseLocality` is the exception: the lokalitet's own fields are edited
// through `activeLocalityAtom`, because half the app reads the rectangle off
// it, so the atom holds the edits and the draft holds the copy to put back.
// Screenshots and uploads are bytes, written eagerly and compensated on
// `Avbryt` — that is what `eagerIds` is for.

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
  /**
   * A re-drawn sketch's new scene, or an upload's placement. Must be the whole
   * object: PocketBase replaces a JSON field wholesale, so a partial `meta`
   * silently deletes the rest of the record's.
   */
  meta?: Record<string, unknown>;
  /**
   * Which funn this bilde belongs to. May hold a temp id, which the commit
   * maps once the funn has been written. Optional rather than `[]` so a patch
   * that never mentions it leaves the record's own relation alone.
   */
  funn?: string[];
};

/** A View kept during the session: a spec, with no pixels behind it yet. */
export type DraftSpec = DraftAttachment & {
  kind: AttachmentKind;
  meta: Record<string, unknown>;
  /**
   * What this is a layer on: a sketch's tracing, a scene's membership. Empty
   * for every other kind. May hold temp ids, which the commit maps once the
   * records they name have been written.
   */
  over?: string[];
  /**
   * The exhibit position it was minted with, so the commit can tell an
   * arranged spec from an untouched one and only spend a second request on
   * the ones the author actually moved or hid.
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
  /** Files written straight through; `Avbryt` deletes them to compensate. */
  eagerIds: string[];
};

const TEMP_PREFIX = 'draft:';

/** Whether an id belongs to something that only exists in the buffer. */
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

// Temp ids. A module counter because the caller needs the id before the state
// update that uses it; the run timestamp is required, or a recovered buffer's
// ids from a previous page load would collide with a counter starting at one.
let mintCounter = 0;
const mintRun = Date.now().toString(36);

export const mintDraftId = (): string =>
  `${TEMP_PREFIX}${mintRun}.${(mintCounter++).toString(36)}`;

// The record as the buffer would have written it, for the `base` argument
// below. A patch is stored whole, not as the field that changed: undoing a
// deferred deletion has to give back the author's fields, not the server's.
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
  // Records written before 1700000700 have no key at all.
  funn: rec.funn ?? [],
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

// One invented this session leaves no trace; one that exists on the server
// gets a tombstone and keeps its buffered patch, so undelete restores it as
// the author last left it.
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

export const dropAttachment = (d: LocalityDraft, id: string): LocalityDraft => {
  if (id in d.newSpecs) {
    const newSpecs = { ...d.newSpecs };
    delete newSpecs[id];
    return { ...d, newSpecs };
  }
  if (d.attachmentDeletes.includes(id)) return d;
  return { ...d, attachmentDeletes: [...d.attachmentDeletes, id] };
};

// `Slett bildet` writes straight through, so after it every arm of the buffer
// still naming the id is a write against a 404. All four must drop it at once.
export const forgetAttachment = (
  d: LocalityDraft,
  id: string,
): LocalityDraft => {
  const attachments = { ...d.attachments };
  delete attachments[id];
  const newSpecs = { ...d.newSpecs };
  delete newSpecs[id];
  return {
    ...d,
    attachments,
    newSpecs,
    attachmentDeletes: d.attachmentDeletes.filter((x) => x !== id),
    eagerIds: d.eagerIds.filter((x) => x !== id),
  };
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

// Reading the buffer back: the server's list, patched, plus what the session
// invented. Records with a deferred deletion stay in it — the surfaces grey
// them off `deletedIds` so taking the deletion back is one press. The
// synthesised rows are real record shapes, so no surface needs a second type.
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
      funn: body.funn ?? [],
      over: body.over ?? [],
      sort: body.sort,
      hidden: body.hidden,
      created: '',
      updated: '',
    });
  }
  // Buffered specs carry a clock-derived `sort` like every other new record,
  // so one sort puts them where they belong rather than always last.
  return out.sort((a, b) => a.sort - b.sort);
};

// What `Avbryt` names, and what decides whether it asks at all. Counts work,
// not writes.
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
 * The lokalitet's own patch, or null when nothing on it moved. Diffed rather
 * than accumulated, so typing a name and typing it back costs no write.
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

// Persistence: the draft must survive a crash, since under a transaction
// closing the tab would otherwise lose the whole session. Keyed on the
// lokalitet id, one draft each, so two tabs on two sites do not fight. A write
// failure is swallowed — a full quota loses the recovery copy, not the edit.
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
