import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { type ViewMode, VIEW_MODES } from '../map/compare/halves';
import { ControlButton } from '../ui/ControlButton';
import { ControlUnit } from '../ui/ControlUnit';
import type { MaterialSymbol } from '../ui/Icon';
import type { ViewControls } from './useViewControls';

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
