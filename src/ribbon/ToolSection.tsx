// The right of the band: what is true whichever ground is up.
//
// The Kulturminner themes are drawn over all three grounds, the topo base with
// holes under all three, and an origin that stops answering can spoil any of
// them — so none of that belongs to an arm, and all of it belongs here. Search
// and whatever the reader's own records turn out to need go here after them.
//
// What is here today is the Kulturminner overlay, terrain analysis and — only
// while something is down — the upstream fault chip.
//
// Kulturminner leads because it is the reading the app is for and it is
// switched constantly; the analysis follows because it is the expensive one and
// because on the map it draws underneath, so the two read in the same order in
// the band as on the ground. The fault chip stays last whatever joins them: it
// comes and goes on its own, and the far end of the row is where an arriving
// control moves nothing the reader was about to click.

import { Group } from '@mantine/core';
import { HeritageControlGroup, useHeritageControls } from '../heritageControls';
import { TerrainControlGroup, useTerrainControls } from '../terrainControls';
import styles from './Ribbon.module.css';
import { UpstreamStatus } from './UpstreamStatus';

export const ToolSection = () => {
  const heritage = useHeritageControls();
  // Mounted here and nowhere else: a second mount is a second DEM, a second
  // horizon scan and a second canvas over the same ground.
  const terrain = useTerrainControls();

  return (
    <Group gap="xs" wrap="nowrap" className={styles.tools}>
      <HeritageControlGroup heritage={heritage} />
      <TerrainControlGroup terrain={terrain} />
      <UpstreamStatus />
    </Group>
  );
};
