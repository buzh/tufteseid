import type { EvidenceRecord } from '../api/evidence';
import type { EvidenceGroup } from './groups';

// Epoch milliseconds, the same units `nextEvidenceSort` writes.
const STEP_MS = 60_000;

/** `list` with the row at `from` displayed at `to` instead, both indices into
 *  the list as drawn. */
export const moved = <T>(list: readonly T[], from: number, to: number): T[] => {
  const rest = [...list];
  const [row] = rest.splice(from, 1);
  rest.splice(to, 0, row);
  return rest;
};

type SortWrite = { id: string; sort: number };

/**
 * The `sort` writes for a group moved from slot `from` to slot `to`, or null
 * where the gap it lands in has no room — the caller renumbers the list
 * instead (`evenSorts`). One key for the whole group, the tie-break on
 * `created` keeping its own tiles in order, so a move writes the group that
 * moved and nothing else.
 */
export const groupMoveSorts = (
  groups: readonly EvidenceGroup[],
  from: number,
  to: number,
): SortWrite[] | null => {
  const next = moved(groups, from, to);
  const keys = (list: readonly EvidenceGroup[]) =>
    list.flatMap((group) => group.rows.map((rec) => rec.sort));
  const below = keys(next.slice(0, to));
  const above = keys(next.slice(to + 1));
  const lo = below.length > 0 ? Math.max(...below) : null;
  const hi = above.length > 0 ? Math.min(...above) : null;
  // One millisecond past the end, not a step: `nextEvidenceSort` is
  // `Date.now()`, and a key well ahead of it would land the next picture kept
  // before this one rather than last.
  const sort =
    lo == null
      ? hi == null
        ? null
        : hi - 1
      : hi == null
        ? lo + 1
        : Math.floor((lo + hi) / 2);
  // No room, or a list whose groups interleave and so has never been
  // renumbered.
  if (sort == null) return null;
  if ((lo != null && sort <= lo) || (hi != null && sort >= hi)) return null;
  return next[to].rows
    .filter((rec) => rec.sort !== sort)
    .map((rec) => ({ id: rec.id, sort }));
};

// The `sort` writes for a list reshuffled whole — a mosaic moves as a block, so
// there is no single row to slip between two neighbours. Evenly spaced keys
// ending on the list's current greatest, so none moves ahead of `Date.now()`
// and a picture kept after still lands last. A key belongs to a slot rather
// than to a row, so once a list is spaced only what changed slots is written.
export const evenSorts = (list: readonly EvidenceRecord[]): SortWrite[] => {
  const last = Math.max(...list.map((rec) => rec.sort));
  return list
    .map((rec, i) => ({
      id: rec.id,
      sort: last - (list.length - 1 - i) * STEP_MS,
    }))
    .filter((write, i) => write.sort !== list[i].sort);
};
