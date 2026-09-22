// Terrenganalyse, on or off. The whole control is the box: one press frames a
// square on what you are looking at, fetches the float heights under it and
// paints the relief itself; the next takes the render and the frame down
// together.
//
// On is a fetch, not a blind. Every other toggle in the band switches something
// already in the browser, so off can be a cover over a kept selection; here off
// releases 19 MB of elevation for a rectangle the reader has panned away from,
// which is most of the reason the control exists. What survives is the reading
// — the visualization, the sun, the radius — so coming back is one press and
// the same picture somewhere else.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import type { TerrainControls } from './useTerrainControls';

export const TerrainToggle = ({ terrain }: { terrain: TerrainControls }) => {
  const { t } = useTranslation();
  const { on, toggle } = terrain;

  return (
    // The tooltip says what the click does, which is the opposite thing in each
    // state; the label is the same word either way and cannot.
    <Tooltip label={on ? t('terrainControls.hide') : t('terrainControls.show')}>
      <ControlButton
        icon="elevation"
        on={on}
        aria-label={t('terrainControls.label')}
        aria-pressed={on}
        onClick={toggle}
      />
    </Tooltip>
  );
};
