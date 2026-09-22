// The top band. It answers one question — what is on the screen — and hosts the
// surfaces that let the reader change the answer.
//
// The controls themselves live in their own directories, because they are
// surfaces and this is a place to put one: a pane in a split view would mount
// the same arms against its own controllers. What belongs to the band and not
// to any arm is the upstream fault chip, which is about the map rather than
// about one ground.
//
// The row is the ground switch and then the arm belonging to whatever the
// switch says. One arm at a time: a row carrying the controls of a ground that
// is not drawing would be three surfaces claiming the same map. The three
// controllers are mounted here regardless, above the branch — each remembers
// something across a visit to another ground (the Kart variant, the ortofoto
// acquisition, the LiDAR flight and render), and a controller unmounted with
// its arm would forget it.
//
// Still unbuilt, with live atoms and no writer: the Hybrid overlay and its
// contours, the compare curtain, the Kulturminner themes, and search.

import { Group } from '@mantine/core';
import { FlyfotoControlGroup, useFlyfotoControls } from '../flyfotoControls';
import { GroundMenu, useGroundControls } from '../grounds';
import { KartControlGroup, useKartControls } from '../kartControls';
import { LidarControlGroup, useLidarControls } from '../lidarControls';
import styles from './Ribbon.module.css';
import { UpstreamStatus } from './UpstreamStatus';

export const Ribbon = () => {
  const lidar = useLidarControls();
  const kart = useKartControls();
  const flyfoto = useFlyfotoControls();
  // Entering a ground is the arm's own business — each remembers a different
  // thing about where the reader left it, and `useGroundControls` says why.
  const ground = useGroundControls({
    lidar: lidar.enterLidar,
    kart: kart.enterKart,
    flyfoto: flyfoto.enterFlyfoto,
  });

  return (
    <header className={styles.ribbon}>
      <Group gap="xs" wrap="nowrap" className={styles.group}>
        <GroundMenu ground={ground} />

        {ground.mode === 'lidar' && <LidarControlGroup lidar={lidar} />}
        {ground.mode === 'kart' && <KartControlGroup kart={kart} />}
        {ground.mode === 'flyfoto' && (
          <FlyfotoControlGroup flyfoto={flyfoto} />
        )}

        {/* Outside the arms: the topo base under the grounds with holes and the
            Kulturminner themes over all of them are drawn whichever ground is
            up, so their outages have to be sayable on any of them. */}
        <UpstreamStatus />
      </Group>
    </header>
  );
};
