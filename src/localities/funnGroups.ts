/*
 * Which funn a bilde belongs to. `attachments.funn` is a multiple relation
 * carrying a single answer, and it does not cascade, so a dangling id must read
 * as "none" everywhere at once — hence `funnIdOf` taking the funn that exist
 * rather than trusting the column. The grouping lives here because a group's
 * order is its paint order, so the same sequence has to reach
 * `setGroundOverlayStack`, `setSketchOverlays` and the pulldowns.
 */

import type { LocalityFindRecord } from '../api/localityFinds';

type HasFunn = { funn?: string[] };

/** The funn this record belongs to, or null — including a dangling id. */
export const funnIdOf = (
  rec: HasFunn,
  known: ReadonlySet<string>,
): string | null => {
  for (const id of rec.funn ?? []) if (known.has(id)) return id;
  return null;
};

export type FunnGroup<T> = {
  /** Null for the lokalitet's own images. */
  funn: LocalityFindRecord | null;
  items: T[];
};

/** The lokalitet's own first, then one group per funn in creation order. Empty
 * groups are dropped, so ungrouped is `length === 1`. */
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

/** The same order, flattened. */
export const orderedByFunn = <T extends HasFunn>(
  items: readonly T[],
  finds: readonly LocalityFindRecord[] | null,
): T[] => funnGroupsOf(items, finds).flatMap((g) => g.items);

/** Headings by record id, null when there is only one group. Labels are passed
 * in rather than translated here, so there is one copy of them. */
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
