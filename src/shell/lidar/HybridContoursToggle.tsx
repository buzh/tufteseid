import { useTranslation } from 'react-i18next';
import { Switch, Tooltip } from '../../ui';

/**
 * Contour lines on Hybrid's reference overlay.
 *
 * A `Switch` rather than a `Segmented`, unlike everything else on the strip:
 * the other controls pick one of several things and this one is on or off,
 * and an Av|På pair would spend twice the width saying so.
 *
 * Only rendered in Hybrid, never in plain LiDAR — the lines arrive as two
 * more groups in the overlay's own GetMap, so without the overlay there is
 * nothing for them to ride on. That is also why they are worth having at all:
 * a hillshade tells you a slope is steep and a contour tells you it drops
 * forty metres, and the second is what turns "there is something there" into
 * a measurement.
 */
export const HybridContoursToggle = ({
  contours,
  onChange,
}: {
  contours: boolean;
  onChange: (next: boolean) => void;
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t('ribbon.hybrid.contoursTip')}>
      <Switch
        checked={contours}
        onChange={onChange}
        label={t('ribbon.hybrid.contours')}
      />
    </Tooltip>
  );
};
