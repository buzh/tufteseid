import { useTranslation } from 'react-i18next';
import { Switch, Tooltip } from '../../ui';

// Contour lines on Hybrid's reference overlay. Hybrid only: the lines arrive
// as two more groups in the overlay's own GetMap.
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
