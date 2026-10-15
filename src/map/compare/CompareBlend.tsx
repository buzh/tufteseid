import { Slider, Tooltip } from '@mantine/core';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../ui/Icon';
import { compareBlendAtom, DEFAULT_BLEND_PERCENT } from './atoms';
import styles from './CompareBlend.module.css';
import { setCompareBlend } from './compareLayers';
import { useLinkedPercent } from './linkedPercent';

const BLEND_STEP = 5;

export const CompareBlend = () => {
  const { t } = useTranslation();
  const [blend, setBlend] = useAtom(compareBlendAtom);

  useLinkedPercent('blend', blend, DEFAULT_BLEND_PERCENT);

  const applyBlend = (percent: number) => {
    const fraction = percent / 100;
    setCompareBlend(fraction);
    setBlend(fraction);
  };

  return (
    <div className={styles.bar} onKeyDown={(e) => e.stopPropagation()}>
      <Tooltip label={t('viewControls.fade')}>
        <span className={styles.icon}>
          <Icon icon="opacity" size={16} />
        </span>
      </Tooltip>
      <Slider
        className={styles.slider}
        size="xs"
        min={0}
        max={100}
        step={BLEND_STEP}
        label={(value) => `${value} %`}
        aria-label={t('viewControls.fade')}
        value={Math.round(blend * 100)}
        onChange={applyBlend}
      />
    </div>
  );
};
