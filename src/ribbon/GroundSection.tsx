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
  // A two-ground view mounts this twice, so the section carries the only label
  // saying which half its controls drive.
  const twoGrounds = useAtomValue(compareOnAtom);
  const sectionLabel = twoGrounds
    ? t(`ribbon.groundSection.${half === 'a' ? 'left' : 'right'}`)
    : t('ribbon.groundSection.only');

  const lidar = useLidarControls(half);
  const kart = useKartControls(half);
  const flyfoto = useFlyfotoControls(half);
  // All three controllers are mounted whichever arm is showing: each remembers
  // something across a visit to another ground.
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
