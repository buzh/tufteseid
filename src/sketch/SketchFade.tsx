import { Slider, Tooltip } from '@mantine/core';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { sketchFadeAtom, sketchShownAtom } from './overlay';
import styles from './SketchFade.module.css';

export const SketchFade = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  const shown = useAtomValue(sketchShownAtom);
  const [fade, setFade] = useAtom(sketchFadeAtom);

  return (
    <div className={cx(styles.row, className)}>
      <Tooltip label={t('spots.sketchFade')}>
        <span className={styles.icon}>
          <Icon icon="draw" size={16} />
        </span>
      </Tooltip>
      <Slider
        className={styles.slider}
        size="xs"
        min={0}
        max={100}
        step={5}
        disabled={!shown}
        label={(value) => `${value} %`}
        aria-label={t('spots.sketchFade')}
        value={fade}
        onChange={setFade}
      />
    </div>
  );
};
