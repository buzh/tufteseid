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

/**
 * The `sort` that puts `id` at `to` of `list`, which is the order on screen, or
 * null for a row already there. A row dropped last takes the current time
 * rather than a step past its neighbour, so a picture kept a moment later still
 * lands after it.
 */
export const sortForMove = (
  list: readonly EvidenceRecord[],
  id: string,
  to: number,
): number | null => {
  const from = list.findIndex((rec) => rec.id === id);
  if (from < 0 || from === to) return null;

  const rest = list.filter((rec) => rec.id !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  const before: number | undefined = rest[at - 1]?.sort;
  const after: number | undefined = rest[at]?.sort;

  if (before == null) return (after ?? Date.now()) - STEP_MS;
  if (after == null) return Math.max(before + STEP_MS, Date.now());
  return (before + after) / 2;
};
