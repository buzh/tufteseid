import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLidarStyleRingHint } from '../../localities/bilderRing';
import { lidarStyleLabel } from '../../map/layers/config/backgroundLayers/lidarProjects';
import { Button, CountBadge, Popover } from '../../ui';
import { PulldownDisclosure, PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import type { LidarControls } from './useLidarControls';

// The styled variants the WMS publishes for the active dataset; the tier-A
// list is the ring A/D walks, when a bilder rail has not taken A/D. Rendered
// only when there is more than one style.
export const LidarStylePicker = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hint = useLidarStyleRingHint();

  const pick = (style: string) => {
    lidar.setActiveLidarStyle(style);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={230}
      padded={false}
      label={t('ribbon.lidar.styleLabel')}
      className={styles.trigger}
      trigger={
        <>
          <Button
            variant="secondary"
            size="md"
            rightIcon="arrow_drop_down"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <span className={styles.triggerLabel}>
            {lidarStyleLabel(lidar.shownStyle)}
          </span>
          </Button>
          <CountBadge
            count={lidar.datasetStyles.length}
            palette="yellow"
            className={styles.triggerBadge}
          />
        </>
      }
    >
      <div className={styles.head}>
        <span>
          {t('ribbon.lidar.styleHead')}
          {hint}
        </span>
      </div>
      {lidar.tierAStyles.map((style) => (
        <PulldownItem
          key={style}
          label={lidarStyleLabel(style)}
          active={lidar.shownStyle === style}
          onActivate={() => pick(style)}
        />
      ))}
      {lidar.tierBStyles.length > 0 && (
        <StyleOverflow lidar={lidar} onPick={pick} />
      )}
    </Popover>
  );
};

const StyleOverflow = ({
  lidar,
  onPick,
}: {
  lidar: LidarControls;
  onPick: (style: string) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PulldownDisclosure
        open={open}
        label={t('ribbon.lidar.moreStyles', {
          count: lidar.tierBStyles.length,
        })}
        onToggle={() => setOpen(!open)}
      />
      {open &&
        lidar.tierBStyles.map((style) => (
          <PulldownItem
            key={style}
            label={lidarStyleLabel(style)}
            active={lidar.shownStyle === style}
            onActivate={() => onPick(style)}
          />
        ))}
    </>
  );
};
