// The right of the band: what is true whichever ground is up.
//
// The Kulturminner themes are drawn over all three grounds, the topo base with
// holes under all three, and an origin that stops answering can spoil any of
// them — so none of that belongs to an arm, and all of it belongs here. Search
// and whatever the reader's own records turn out to need go here after them.
//
// What is here today is the Kulturminner overlay, the terrain analysis on/off
// button, the `+` that starts a spot, the account, and — only while something
// is down — the upstream fault chip.
//
// Kulturminner leads because it is the reading the app is for and it is
// switched constantly; the analysis follows because it is the expensive one and
// because on the map it draws underneath, so the two read in the same order in
// the band as on the ground. Then the reader's own two: the `+` writes a record
// and the account is what it is written under, which is why they stand
// together and after the two that only read. The fault chip stays last whatever
// joins them: it comes and goes on its own, and the far end of the row is where
// an arriving control moves nothing the reader was about to click.
//
// The analysis is one box here and nothing else. Its settings are in a panel
// floating on the map, mounted by `MapComponent` and holding the DEM — the band
// carries the switch, because that is the part that is a peer of the other
// tools, and the readings belong next to the picture they change.

import { Group } from '@mantine/core';
import { AuthButton } from '../auth';
import { HeritageControlGroup, useHeritageControls } from '../heritageControls';
import { SpotToggle } from '../spotControls';
import { TerrainToggle } from '../terrainControls';
import styles from './Ribbon.module.css';
import { UpstreamStatus } from './UpstreamStatus';

export const ToolSection = () => {
  const heritage = useHeritageControls();

  return (
    <Group gap="xs" wrap="nowrap" className={styles.tools}>
      <HeritageControlGroup heritage={heritage} />
      <TerrainToggle />
      <SpotToggle />
      <AuthButton />
      <UpstreamStatus />
    </Group>
  );
};
