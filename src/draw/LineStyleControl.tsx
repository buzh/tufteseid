import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { LineStyle, lineStyleAtom } from '../settings/draw/atoms';
import { Segmented, type SegmentedOption } from '../ui';
import styles from './Draw.module.css';

export const LineStyleControl = () => {
  const [lineStyle, setLineStyle] = useAtom(lineStyleAtom);
  const { t } = useTranslation();

  // Named rather than drawn as `____` / `_ _ _`: the underscore rows were the
  // one label in here a screen reader could make nothing of, and two words
  // cost no more width than they did.
  const options: SegmentedOption<LineStyle>[] = [
    { value: 'solid', label: t('draw.controls.lineTypeSolid') },
    { value: 'dashed', label: t('draw.controls.lineTypeDashed') },
  ];

  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>{t('draw.controls.lineType')}</span>
      <Segmented
        value={lineStyle}
        options={options}
        onChange={setLineStyle}
        label={t('draw.controls.lineType')}
      />
    </div>
  );
};
