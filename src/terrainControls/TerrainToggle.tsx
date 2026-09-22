// Terrenganalyse, on or off. The whole control is the box: one press frames a
// square on what you are looking at, fetches the float heights under it and
// paints the relief itself; the next takes the render, the frame and the
// settings box down together.
//
// A button alone, with no chip beside it. Everything there is to say about a
// running analysis — which visualization, at what resolution, in what light —
// is in the box floating over the map, and a readout in the band saying the
// same thing a hand's width away would be a second place to look.
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
import { useTerrainToggle } from './useTerrainToggle';

export const TerrainToggle = () => {
  const { t } = useTranslation();
  const { on, toggle } = useTerrainToggle();

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
