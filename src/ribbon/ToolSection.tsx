// The right of the band: what is true whichever ground is up.
//
// The Kulturminner themes are drawn over all three grounds, the topo base with
// holes under all three, and an origin that stops answering can spoil any of
// them — so none of that belongs to an arm, and all of it belongs here. This is
// where the theme-layer toggle goes when it is built (`activeThemeLayersAtom`
// and the `heritage*` atoms in `src/map/layers/`), and where search and
// whatever the reader's own records turn out to need will go after it.
//
// What is here today is the upstream fault chip, and only while something is
// down. The section is the far end of the row on purpose: away from the
// controls the reader's cursor is already heading for.

import { Group } from '@mantine/core';
import styles from './Ribbon.module.css';
import { UpstreamStatus } from './UpstreamStatus';

export const ToolSection = () => (
  <Group gap="xs" wrap="nowrap" className={styles.tools}>
    <UpstreamStatus />
  </Group>
);
