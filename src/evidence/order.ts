import type { EvidenceRecord } from '../api/evidence';

const STEP_MS = 60_000;

export const moved = <T>(list: readonly T[], from: number, to: number): T[] => {
  const rest = [...list];
  const [row] = rest.splice(from, 1);
  rest.splice(to, 0, row);
  return rest;
};

type SortWrite = { id: string; sort: number };

const renumbered = (list: readonly EvidenceRecord[]): SortWrite[] => {
  const last = Math.max(...list.map((rec) => rec.sort));
  return list
    .map((rec, i) => ({
      id: rec.id,
      sort: last - (list.length - 1 - i) * STEP_MS,
    }))
    .filter((write, i) => write.sort !== list[i].sort);
};

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

  if (between > before && between < after) return [{ id, sort: between }];
  return renumbered(moved(list, from, to));
};
