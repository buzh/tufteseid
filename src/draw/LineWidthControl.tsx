import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  LineWidth,
  lineWidthAtom,
  selectedFeatureAtom,
} from '../settings/draw/atoms';
import { Segmented, type SegmentedOption } from '../ui';
import styles from './Draw.module.css';
import { getFeatureType } from './drawControls/drawUtils';
import { useDrawSettings } from './drawControls/hooks/drawSettings';

// The three widths, as the strings `Segmented` indexes on.
const widthOptions: SegmentedOption<string>[] = [
  { value: '2', label: 'S' },
  { value: '4', label: 'M' },
  { value: '8', label: 'L' },
];

export const LineWidthControl = () => {
  const [lineWidth, setLineWidth] = useAtom(lineWidthAtom);
  const [selectedFeature] = useAtom(selectedFeatureAtom);

  const { drawType } = useDrawSettings();
  const { t } = useTranslation();
  const selectedFeatureType = selectedFeature
    ? getFeatureType(selectedFeature)
    : null;

  const currentType = drawType === 'Move' ? selectedFeatureType : drawType;

  if (
    currentType !== 'LineString' &&
    currentType !== 'Point' &&
    currentType !== 'Polygon'
  ) {
    return null;
  }

  const label =
    currentType === 'Point' ? t('draw.size.pointLabel') : t('draw.size.label');

  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{label}</span>
      <Segmented
        value={String(lineWidth)}
        options={widthOptions}
        onChange={(value) => setLineWidth(Number(value) as LineWidth)}
        label={label}
      />
    </div>
  );
};
