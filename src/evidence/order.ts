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

type SortWrite = { id: string; sort: number };

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
