import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, CountBadge, Popover } from '../../ui';
import { PulldownDisclosure, PulldownItem } from '../Pulldown';
import styles from '../Pulldown.module.css';
import type { LidarControls } from './useLidarControls';

/**
 * Which styled variant of the active dataset to render — hillshade, slope,
 * and whatever else the WMS publishes for it. Rarer ones sit behind "flere
 * stiler"; the short list above is the same ring A/D walks.
 *
 * Rendered only when the dataset publishes more than one. The national
 * mosaic and everything in DOM mode publish exactly one, and a pulldown with
 * a single entry is a label wearing a chevron.
 */
export const LidarStylePicker = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

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
            <span className={styles.triggerLabel}>{lidar.shownStyle}</span>
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
        <span>{t('ribbon.lidar.styleHead')}</span>
      </div>
      {lidar.tierAStyles.map((style) => (
        <PulldownItem
          key={style}
          label={style}
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
            label={style}
            active={lidar.shownStyle === style}
            onActivate={() => onPick(style)}
          />
        ))}
    </>
  );
};
