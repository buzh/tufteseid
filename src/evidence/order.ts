import type { EvidenceRecord } from '../api/evidence';
import type { EvidenceGroup } from './groups';

const STEP_MS = 60_000;

export const moved = <T>(list: readonly T[], from: number, to: number): T[] => {
  const rest = [...list];
  const [row] = rest.splice(from, 1);
  rest.splice(to, 0, row);
  return rest;
};

type SortWrite = { id: string; sort: number };

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
  const sort =
    lo == null
      ? hi == null
        ? null
        : hi - 1
      : hi == null
        ? lo + 1
        : Math.floor((lo + hi) / 2);
  if (sort == null) return null;
  if ((lo != null && sort <= lo) || (hi != null && sort >= hi)) return null;
  return next[to].rows
    .filter((rec) => rec.sort !== sort)
    .map((rec) => ({ id: rec.id, sort }));
};

export const evenSorts = (list: readonly EvidenceRecord[]): SortWrite[] => {
  const last = Math.max(...list.map((rec) => rec.sort));
  return list
    .map((rec, i) => ({
      id: rec.id,
      sort: last - (list.length - 1 - i) * STEP_MS,
    }))
    .filter((write, i) => write.sort !== list[i].sort);
};
