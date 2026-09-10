import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { showMeasurementsAtom } from '../settings/draw/atoms';
import { Switch } from '../ui';
import styles from './Draw.module.css';

export const MeasurementControls = () => {
  const { t } = useTranslation();
  const [showMeasurements, setShowMeasurements] = useAtom(showMeasurementsAtom);

  return (
    <Switch
      checked={showMeasurements}
      onChange={setShowMeasurements}
      label={t('draw.controls.showMeasurements')}
      className={styles.rowSwitch}
    />
  );
};
