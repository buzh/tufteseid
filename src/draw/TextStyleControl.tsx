import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  TextFontSize,
  textFontSizeAtom,
  textInputAtom,
} from '../settings/draw/atoms';
import { Input, Segmented, type SegmentedOption } from '../ui';
import styles from './Draw.module.css';

const fontSizeOptions: SegmentedOption<string>[] = [
  { value: '12', label: 'S' },
  { value: '16', label: 'M' },
  { value: '24', label: 'L' },
];

export const TextStyleControl = () => {
  const [textValue, setTextValue] = useAtom(textInputAtom);
  const [fontSize, setFontSize] = useAtom(textFontSizeAtom);
  const { t } = useTranslation();

  return (
    <div className={styles.row}>
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('draw.textInputLabel')}</span>
        <Input
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
        />
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('draw.size.textLabel')}</span>
        <Segmented
          value={String(fontSize)}
          options={fontSizeOptions}
          onChange={(value) => setFontSize(Number(value) as TextFontSize)}
          label={t('draw.size.textLabel')}
        />
      </div>
    </div>
  );
};
