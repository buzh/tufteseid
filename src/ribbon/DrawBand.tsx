// The band while a drawing is open. The map's own sections are away with the
// boxes: nothing here may change the ground under strokes already registered
// to it, so all the band carries is whose drawing this is and the two ways
// out. The tools themselves are on the canvas (`sketch/SketchTools`).

import { Button } from '@mantine/core';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { drawHoldAtom } from '../shared/uiContext';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import styles from './Ribbon.module.css';

export const DrawBand = () => {
  const { t } = useTranslation();
  const hold = useAtomValue(drawHoldAtom);

  return (
    <header className={cx(styles.ribbon, styles.drawBand)}>
      <span className={styles.drawing}>
        <Icon icon="draw" size={16} />
        <span className={styles.drawingName}>
          {hold?.name
            ? t('spots.drawingOn', { name: hold.name })
            : t('spots.drawingHere')}
        </span>
      </span>

      <div className={cx(styles.side, styles.tools)}>
        <Button
          size="xs"
          variant="default"
          disabled={!hold}
          onClick={() => hold?.abort()}
        >
          {t('spots.abort')}
        </Button>
        <Button size="xs" disabled={!hold} onClick={() => hold?.save()}>
          {t('spots.save')}
        </Button>
      </div>
    </header>
  );
};
