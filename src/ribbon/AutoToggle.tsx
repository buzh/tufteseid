// Automatisk: hand the dataset choice to the viewport, or take it back.
//
// A button beside the pulldowns rather than a row inside one, because it is not
// a dataset — it is who gets to name the dataset. While it is on the two chips
// are dimmed: still operable, but what they show is a decision that may be
// overruled on the next pan, and picking anything in either of them turns this
// off (`useLidarControls`).
//
// Icon alone, at the size of the model toggle: the word "Automatisk" was the
// widest thing on the ribbon and said nothing the filled state does not. What
// it does say — that this is a mode, on or off — the fill carries, and the rest
// is one hover away.

import { Button, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import type { LidarControls } from './useLidarControls';

export const AutoToggle = ({ lidar }: { lidar: LidarControls }) => {
  const { t } = useTranslation();
  const { autoDataset, toggleAuto } = lidar;

  return (
    // The tooltip says what the click does, which is the opposite thing in each
    // state — the label alone cannot, since it is the same word either way.
    <Tooltip
      label={autoDataset ? t('ribbon.auto.onHint') : t('ribbon.auto.offHint')}
    >
      <Button
        size="xs"
        variant={autoDataset ? 'filled' : 'default'}
        w={34}
        px={0}
        aria-label={t('ribbon.auto.label')}
        aria-pressed={autoDataset}
        onClick={toggleAuto}
      >
        <Icon icon="autorenew" size={18} />
      </Button>
    </Tooltip>
  );
};
