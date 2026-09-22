// The middle of the band: how the map is being looked at, rather than what it
// is drawing.
//
// That is the compare curtain — `compareOnAtom`, `compareSplitAtom` and
// `enterCompareAtom` (`src/map/compare/atoms.ts`), all live and none of them
// written by any surface yet. The curtain belongs here and not in
// `GroundSection` because it does not choose a ground: it puts two of them on
// the screen at once and gives one of them focus, and every atom the arms write
// is the `.focused` facade of a `halved()` pair, so the ground section already
// describes whichever side has it.
//
// Empty until that control is built, and deliberately still mounted — the
// section is the slack that pushes `ToolSection` to the right-hand end, and a
// band whose middle appears only once it has contents would move the tools
// sideways the first time the reader opened the curtain.

import { Group } from '@mantine/core';
import styles from './Ribbon.module.css';

export const ViewSection = () => (
  <Group gap="xs" wrap="nowrap" className={styles.views} />
);
