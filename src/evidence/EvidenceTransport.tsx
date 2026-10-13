import { Slider, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import styles from './EvidenceTransport.module.css';
import type { LoopTransport } from './evidenceOverlay';

export const EvidenceTransport = ({
  loop,
  stepDeg,
  className,
}: {
  loop: LoopTransport;
  stepDeg: number;
  className?: string;
}) => {
  const { t } = useTranslation();

  const play = t(loop.playing ? 'evidence.pause' : 'evidence.play');
  const last = 360 - stepDeg;

  const azimuth = Math.min(
    last,
    Math.floor((loop.progress * 360) / stepDeg) * stepDeg,
  );

  return (
    <div className={cx(styles.row, className)}>
      <Tooltip label={play}>
        <ControlButton
          icon={loop.playing ? 'pause' : 'play_arrow'}
          aria-label={play}
          onClick={loop.toggle}
        />
      </Tooltip>
      <Slider
        className={styles.slider}
        size="xs"
        min={0}
        max={last}
        step={stepDeg}
        disabled={!loop.ready}
        label={(value) => `${value}°`}
        aria-label={t('evidence.azimuth')}
        value={azimuth}
        onChange={(value) => loop.seek(value / 360)}
      />
    </div>
  );
};
