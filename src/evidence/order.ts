// Where a dragged row lands. `sort` is an ordering key rather than an index, so
// a drop writes the moved row and nothing else: the list can be reordered from
// one box while a render lands in another.

import type { EvidenceRecord } from '../api/evidence';

// How far past the end a row goes when it is dropped there. Epoch
// milliseconds: the keys are set at creation, seconds apart, which leaves a gap
// no amount of halving between the same two neighbours will exhaust.
const STEP_MS = 60_000;

/** `list` with the row at `from` displayed at `to` instead. Both are indices
 *  into the list as drawn. */
export const moved = <T>(list: readonly T[], from: number, to: number): T[] => {
  const rest = [...list];
  const [row] = rest.splice(from, 1);
  rest.splice(to, 0, row);
  return rest;
};

/**
 * The `sort` that puts `id` at `to` of `list`, which is the order on screen, or
 * null for a row that is already there. A row dropped last takes the current
 * time rather than a step past its neighbour, so a picture kept a moment later
 * still lands after it.
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
