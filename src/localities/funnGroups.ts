/*
 * Which funn a bilde belongs to (docs/lokalitet-view.md §13.6, §13.10 step 9).
 *
 * `attachments.funn` has existed since 1700000700 and meant one thing: what a
 * *sketch* is about, seeded from the selected funn when the drawing was kept
 * and never editable afterwards. Step 9 widens it to "which funn this bilde
 * belongs to", on every kind, which costs no migration — the column is the
 * same uncascaded multiple relation — and turns a funn into a container for
 * images as well as a sublocation. The two roles are orthogonal: a funn is
 * still named, statused, addressable and on the map whether or not anything
 * hangs off it.
 *
 * ## One answer, in a multi-valued column
 *
 * "Belongs to" is a single answer, so the editor writes at most one id and
 * everything here reads the first one it recognises. The field stays a
 * multiple relation because that is what it already is and because the
 * sketch's older sense — *about* these funn — is a plural idea that may yet
 * want the room; nothing has ever written more than one, so no record is
 * being reinterpreted.
 *
 * ## A dangling id is "none"
 *
 * §13.6's first consequence, and the reason `funnIdOf` takes the set of funn
 * that exist rather than trusting the column. The relation does not cascade,
 * so deleting a funn leaves its images pointing at a record that is gone —
 * which is the behaviour we want (the images fall back to the lokalitet, they
 * are not deleted with it) but only if every reader treats the dangling id as
 * no answer. Doing that in one function is what stops the pulldowns, the card
 * and the grouping from disagreeing about where an orphan went.
 *
 * ## Why the grouping lives here rather than in the controls
 *
 * `[Bilde ▾]` and `[Skisse ▾]` both group by funn, and the order they list
 * their members in is the order those members paint in (§13.1: position in
 * the row means depth). So the grouping cannot be a display-only sort in one
 * of them — the same sequence has to reach `setGroundOverlayStack` and
 * `setSketchOverlays`, and one flattening used by all three call sites is how
 * that stays true.
 */

import type { LocalityFindRecord } from '../api/localityFinds';

/** The relation as the readers need it: enough of a record to ask. */
type HasFunn = { funn?: string[] };

/**
 * The funn this record belongs to, or null — including when it names one that
 * no longer exists. See the header.
 */
export const funnIdOf = (
  rec: HasFunn,
  known: ReadonlySet<string>,
): string | null => {
  for (const id of rec.funn ?? []) if (known.has(id)) return id;
  return null;
};

export type FunnGroup<T> = {
  /** Null for the lokalitet's own images — the group with no funn. */
  funn: LocalityFindRecord | null;
  items: T[];
};

/**
 * Split a list of bilder into the lokalitet's own and one group per funn.
 *
 * The ungrouped go first and the funn follow in the funn list's own order,
 * which is creation order — so the sequence is stable across a rename and a
 * restatus, and bottom-to-top it reads as "the lokalitet's layers, then each
 * funn's over them". Empty groups are dropped, so a lokalitet where nobody has
 * used the relation comes back as a single group and the surfaces can tell
 * from `length` that there is nothing worth heading.
 */
export const funnGroupsOf = <T extends HasFunn>(
  items: readonly T[],
  finds: readonly LocalityFindRecord[] | null,
): FunnGroup<T>[] => {
  const list = finds ?? [];
  const known = new Set(list.map((f) => f.id));
  const loose: T[] = [];
  const byFunn = new Map<string, T[]>();
  for (const it of items) {
    const id = funnIdOf(it, known);
    if (!id) {
      loose.push(it);
      continue;
    }
    const bucket = byFunn.get(id);
    if (bucket) bucket.push(it);
    else byFunn.set(id, [it]);
  }
  const out: FunnGroup<T>[] = [];
  if (loose.length > 0) out.push({ funn: null, items: loose });
  for (const f of list) {
    const bucket = byFunn.get(f.id);
    if (bucket) out.push({ funn: f, items: bucket });
  }
  return out;
};

/** The same order, flattened — for a caller that paints rather than lists. */
export const orderedByFunn = <T extends HasFunn>(
  items: readonly T[],
  finds: readonly LocalityFindRecord[] | null,
): T[] => funnGroupsOf(items, finds).flatMap((g) => g.items);

/**
 * …and the headings for them, by record id — or null where there is only one
 * group, because a single heading over the whole list names nothing.
 *
 * The two labels are passed in rather than translated here: this module is
 * read by the pin queue's neighbours and by two shell controls, and the one
 * thing worth keeping out of it is a second copy of "what an untitled funn is
 * called".
 */
export const funnSectionsOf = <T extends HasFunn & { id: string }>(
  groups: readonly FunnGroup<T>[],
  labels: { none: string; untitled: string },
): Map<string, string> | null => {
  if (groups.length < 2) return null;
  const out = new Map<string, string>();
  for (const g of groups) {
    const label = g.funn ? g.funn.title.trim() || labels.untitled : labels.none;
    for (const it of g.items) out.set(it.id, label);
  }
  return out;
};
