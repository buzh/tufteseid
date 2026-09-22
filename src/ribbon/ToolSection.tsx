// The right of the band: what is true whichever ground is up.
//
// The Kulturminner themes are drawn over all three grounds, the topo base with
// holes under all three, and an origin that stops answering can spoil any of
// them — so none of that belongs to an arm, and all of it belongs here. Search
// and whatever the reader's own records turn out to need go here after them.
//
// What is here today is the Kulturminner overlay and, only while something is
// down, the upstream fault chip. The fault chip stays last: it comes and goes
// on its own, and the far end of the row is where an arriving control moves
// nothing the reader was about to click.

import { Group } from '@mantine/core';
import { HeritageControlGroup, useHeritageControls } from '../heritageControls';
import styles from './Ribbon.module.css';
import { UpstreamStatus } from './UpstreamStatus';

export const ToolSection = () => {
  const heritage = useHeritageControls();

  return (
    <Group gap="xs" wrap="nowrap" className={styles.tools}>
      <HeritageControlGroup heritage={heritage} />
      <UpstreamStatus />
    </Group>
  );
};
