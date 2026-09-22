// Which ground is drawing, and the controls of that one ground.
//
// One per half that is on the screen: the A section is the left of the band and
// the whole map's ground while one is up, and a two-ground view mounts a second
// for B to the right of the view control. The half is the only argument —
// everything below is written against `half` and none of the four controllers
// knows there is another section.
//
// The controls themselves live in their own directories, because they are
// surfaces and this is a place to put one.
//
// The section is the ground switch and then the arm belonging to whatever the
// switch says. One arm at a time: a row carrying the controls of a ground that
// is not drawing would be three surfaces claiming the same map. The three
// controllers are mounted here regardless, above the branch — each remembers
// something across a visit to another ground (the Kart variant, the ortofoto
// acquisition, the LiDAR flight and render), and a controller unmounted with
// its arm would forget it.
//
// Still unbuilt here, with live atoms and no writer: the Hybrid overlay and its
// contours — two booleans, and the only open question is whether a modifier
// over the ground belongs to this section or to `ToolSection`.

import { Group } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { FlyfotoControlGroup, useFlyfotoControls } from '../flyfotoControls';
import { GroundSwitch, useGroundControls } from '../grounds';
import { KartControlGroup, useKartControls } from '../kartControls';
import { LidarControlGroup, useLidarControls } from '../lidarControls';
import { type CompareHalf, compareOnAtom } from '../map/compare/halves';
import styles from './Ribbon.module.css';

export const GroundSection = ({ half }: { half: CompareHalf }) => {
  const { t } = useTranslation();
  // A two-ground view mounts this twice, so every control in it has a twin with
  // the same name. Nothing inside says which half it drives — the reader can
  // see, because the section stands over the ground it belongs to, and a
  // screen-reader user cannot. The name is on the section rather than on each
  // of its four controls: one label, announced on the way in, and the controls
  // stay named for what they do.
  const twoGrounds = useAtomValue(compareOnAtom);
  const sectionLabel = twoGrounds
    ? t(`ribbon.groundSection.${half === 'a' ? 'left' : 'right'}`)
    : t('ribbon.groundSection.only');

  const lidar = useLidarControls(half);
  const kart = useKartControls(half);
  const flyfoto = useFlyfotoControls(half);
  // Entering a ground is the arm's own business — each remembers a different
  // thing about where the reader left it, and `useGroundControls` says why.
  const ground = useGroundControls(half, {
    lidar: lidar.enterLidar,
    kart: kart.enterKart,
    flyfoto: flyfoto.enterFlyfoto,
  });

  return (
    <Group
      gap="xs"
      wrap="nowrap"
      className={styles.grounds}
      role="group"
      aria-label={sectionLabel}
    >
      <GroundSwitch ground={ground} />

      {ground.mode === 'lidar' && <LidarControlGroup lidar={lidar} />}
      {ground.mode === 'kart' && <KartControlGroup kart={kart} />}
      {ground.mode === 'flyfoto' && <FlyfotoControlGroup flyfoto={flyfoto} />}
    </Group>
  );
};
