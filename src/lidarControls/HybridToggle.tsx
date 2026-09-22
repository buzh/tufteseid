// Kartverket's reference overlay over the relief — roads, railways, place
// names — and, while it is up, its contours.
//
// Two boxes drawn as one control, because they are one subject asked twice:
// whether the relief is annotated at all, and whether the annotation includes
// height. The second only exists while the first is on — contours ride the
// overlay's own GetMap (`topoOverlay.ts`), so a contour button standing alone
// would be a switch with nothing behind it. `ControlUnit` leaves the survivor
// fully rounded on its own, so the shape is honest either way.
//
// Last in the arm, after the model. Everything before it says which relief is
// drawing; this says what is written over whichever one that is, and it is the
// one control here that survives every dataset, render and model switch.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import { ControlUnit } from '../ui/ControlUnit';
import type { LidarControls } from './useLidarControls';

export const HybridToggle = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { hybridOverlay, toggleHybrid, hybridContours, toggleContours } = lidar;

  return (
    <ControlUnit>
      {/* What the click does, which is the opposite thing in each state. */}
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
    </ControlUnit>
  );
};
