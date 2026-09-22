// Automatisk: hand the dataset choice to the viewport, or take it back.
//
// A button beside the pulldowns rather than a row inside one, because it is not
// a dataset — it is who gets to name the dataset. While it is on the two chips
// are dimmed: still operable, but what they show is a decision that may be
// overruled on the next pan, and picking anything in either of them turns this
// off (`useLidarControls`).
//
// Icon alone, at the size of the model toggle: the word "Automatisk" was the
// widest thing in the row and said nothing the filled state does not. What
// it does say — that this is a mode, on or off — the fill carries, and the rest
// is one hover away.
//
// The three measurements are style props and not a class, which is the one way
// round that works. Mantine's Button writes `--button-height` and
// `--button-padding-x` into the element's `style` attribute from its
// `varsResolver`, so a CSS module cannot reach them; style props land in the
// same attribute and win. `rem()` passes a `var(…)` string through untouched,
// so the shared metric survives the trip.

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
      label={
        autoDataset
          ? t('lidarControls.auto.onHint')
          : t('lidarControls.auto.offHint')
      }
    >
      <Button
        size="xs"
        variant={autoDataset ? 'filled' : 'default'}
        h="var(--control-height)"
        w="var(--control-icon-width)"
        px={0}
        aria-label={t('lidarControls.auto.label')}
        aria-pressed={autoDataset}
        onClick={toggleAuto}
      >
        <Icon icon="autorenew" size={18} />
      </Button>
    </Tooltip>
  );
};
