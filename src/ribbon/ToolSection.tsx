// The tools apply whichever ground is up. `UpstreamStatus` stays last: it comes
// and goes on its own, and nothing left of it should move when it does.

import { Group } from '@mantine/core';
import { AuthButton } from '../auth';
import { PlaceInfoToggle } from '../placeInfo';
import { SearchChip } from '../search/SearchChip';
import { SpotControlGroup } from '../spotControls';
import { TerrainToggle } from '../terrainControls';
import styles from './Ribbon.module.css';
import { ShareButton } from './ShareButton';
import { UpstreamStatus } from './UpstreamStatus';

export const ToolSection = () => (
  <Group gap="xs" wrap="nowrap" className={styles.tools}>
    <SearchChip />
    <PlaceInfoToggle />
    <TerrainToggle />
    <SpotControlGroup />
    <ShareButton />
    <AuthButton />
    <UpstreamStatus />
  </Group>
);
