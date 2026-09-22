// The view arm: three buttons drawn as one control, one per view.
//
// Buttons rather than a menu, because the axis is three values a reader moves
// between rather than a list they look something up in — and because the
// difference between the three is a shape, which a glyph carries and a word
// does not. `ControlUnit` joins them into one box so the row reads as a single
// control with three positions.
//
// The order is how much is on the screen: one ground, then two under a seam the
// reader drags, then two side by side. Single stands first because it is what
// the map opens on and what the other two return to.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { type ViewMode, VIEW_MODES } from '../map/compare/halves';
import { ControlButton } from '../ui/ControlButton';
import { ControlUnit } from '../ui/ControlUnit';
import type { MaterialSymbol } from '../ui/Icon';
import type { ViewControls } from './useViewControls';

// The shape of each view, as the frame it puts the ground in: one whole pane,
// one pane cut by a seam, two panes.
const VIEW_ICON: Record<ViewMode, MaterialSymbol> = {
  single: 'crop_square',
  curtain: 'compare',
  split: 'vertical_split',
};

export const ViewControlGroup = ({ view }: { view: ViewControls }) => {
  const { t } = useTranslation();
  const { mode, select } = view;

  return (
    <ControlUnit>
      {VIEW_MODES.map((candidate) => (
        // The name and then what it is for: the glyph is a frame, and a frame
        // says how many grounds but not why a reader would want two.
        <Tooltip
          key={candidate}
          label={t('viewControls.tooltip', {
            view: t(`viewControls.mode.${candidate}`),
            hint: t(`viewControls.meta.${candidate}`),
          })}
        >
          <ControlButton
            icon={VIEW_ICON[candidate]}
            on={candidate === mode}
            aria-label={t(`viewControls.mode.${candidate}`)}
            aria-pressed={candidate === mode}
            onClick={() => select(candidate)}
          />
        </Tooltip>
      ))}
    </ControlUnit>
  );
};
