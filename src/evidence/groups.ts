import type { EvidenceRecord } from '../api/evidence';
import { coverOf, evidenceGroupKey } from './spec';

export type EvidenceGroup = {
  key: string;
  rows: EvidenceRecord[];
  /** The row that stands for the group where only one can: its cover, else the
   *  first row. */
  cover: EvidenceRecord;
};

/** Rows gathered by `evidenceGroupKey` — the tiles of one mosaic in one
 *  group — in first-seen order, each group keeping its rows in the order they
 *  arrived. */
export const groupEvidence = (
  rows: readonly EvidenceRecord[],
): EvidenceGroup[] => {
  const order: string[] = [];
  const byKey = new Map<string, EvidenceRecord[]>();
  for (const rec of rows) {
    const key = evidenceGroupKey(rec);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(rec);
    else {
      byKey.set(key, [rec]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const groupRows = byKey.get(key) as EvidenceRecord[];
    return { key, rows: groupRows, cover: coverOf(groupRows) ?? groupRows[0] };
  });
};
