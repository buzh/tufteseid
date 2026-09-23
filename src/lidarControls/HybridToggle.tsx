// Contours ride the overlay's own GetMap (`topoOverlay.ts`), so the contour
// button exists only while the overlay is on.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { LidarControls } from './useLidarControls';

export const HybridToggle = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { hybridOverlay, toggleHybrid, hybridContours, toggleContours } = lidar;

  return (
    <>
      <Tooltip
        label={
          hybridOverlay
            ? t('lidarControls.hybrid.onHint')
            : t('lidarControls.hybrid.offHint')
        }
      >
        <ControlButton
          icon="signpost"
          on={hybridOverlay}
          aria-label={t('lidarControls.hybrid.label')}
          aria-pressed={hybridOverlay}
          onClick={toggleHybrid}
        />
      </Tooltip>

      {hybridOverlay && (
        <Tooltip
          label={
            hybridContours
              ? t('lidarControls.hybrid.contoursOnHint')
              : t('lidarControls.hybrid.contoursOffHint')
          }
        >
          <ControlButton
            icon="elevation"
            on={hybridContours}
            aria-label={t('lidarControls.hybrid.contours')}
            aria-pressed={hybridContours}
            onClick={toggleContours}
          />
        </Tooltip>
      )}
    </>
  );
};
