import { Slider, Tooltip } from '@mantine/core';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { ControlButton } from '../ui/ControlButton';
import { cx } from '../ui/cx';
import { sketchFadeAtom, sketchShownAtom } from './overlay';
import styles from './SketchFade.module.css';

export const SketchFade = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  const [shown, setShown] = useAtom(sketchShownAtom);
  const [fade, setFade] = useAtom(sketchFadeAtom);

  const label = shown ? t('spots.sketchHide') : t('spots.sketchShow');

  return (
    <div className={cx(styles.row, className)}>
      <Tooltip label={label}>
        <ControlButton
          icon="draw"
          on={shown}
          aria-label={label}
          onClick={() => setShown(!shown)}
        />
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
