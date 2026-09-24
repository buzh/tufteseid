import type { EvidenceRecord } from '../api/evidence';

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

export type SortWrite = { id: string; sort: number };

/** Evenly spaced keys ending on the list's current greatest, so the rows keep
 *  their order without any of them moving ahead of `Date.now()` — a picture
 *  kept after this must still land last. */
const renumbered = (list: readonly EvidenceRecord[]): SortWrite[] => {
  const last = Math.max(...list.map((rec) => rec.sort));
  return list
    .map((rec, i) => ({
      id: rec.id,
      sort: last - (list.length - 1 - i) * STEP_MS,
    }))
    .filter((write, i) => write.sort !== list[i].sort);
};

/**
 * The `sort` writes that put `id` at `to` of `list`, which is the order on
 * screen, or nothing for a row already there. A row dropped last takes the
 * current time rather than a step past its neighbour, so a picture kept a
 * moment later still lands after it.
 */
export const sortsForMove = (
  list: readonly EvidenceRecord[],
  id: string,
  to: number,
): SortWrite[] => {
  const from = list.findIndex((rec) => rec.id === id);
  if (from < 0 || from === to) return [];

  const rest = list.filter((rec) => rec.id !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  const before: number | undefined = rest[at - 1]?.sort;
  const after: number | undefined = rest[at]?.sort;

  if (before == null) return [{ id, sort: (after ?? Date.now()) - STEP_MS }];
  if (after == null) {
    return [{ id, sort: Math.max(before + STEP_MS, Date.now()) }];
  }

  const between = (before + after) / 2;
  // Two rows kept in the same millisecond hold the same key, and halving a gap
  // enough times lands on one end of it: either way there is no key left to
  // drop this row into, and writing one of the neighbours' own would leave the
  // list exactly as it is. Spread the whole list out again instead.
  if (between > before && between < after) return [{ id, sort: between }];
  return renumbered(moved(list, from, to));
};
