// The head of the control row: which ground is being read, and the way to
// another one.
//
// It stands where the wordmark used to, and does that job better — the band
// already had to say which ring the controls belonged to, and three buttons
// that say it can also change it. Everything after it in its section belongs to
// the ground named here, which is why it is first in one. There is one per half
// that is drawing, so in a two-ground view there are two, and which half each
// one drives is said by the section around it rather than by the switch
// (`GroundSection`).
//
// Three buttons drawn as one box, the live one filled in papaya, rather than a
// menu: the axis is three values a reader moves between, not a list they look
// something up in, and a switch that has to be opened before it says which
// ground is up costs a click to read what the row exists to report. Same shape
// as the view control across the band, which is the other three-position axis.
//
// Three and no more. A ground is not a layer: what Kart *means* is the variant
// menu beside this, what LiDAR means is four controls, and folding those members
// in here would make one control of thirty positions out of a choice the reader
// makes in two steps.
//
// No button lit is `?backgroundLayer=empty`, a ground nobody is on. Three
// unpressed buttons say that without a fourth position for it: the reader is
// not on a ground, and the way out is the same three.

import { Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ControlButton } from '../ui/ControlButton';
import { ControlUnit } from '../ui/ControlUnit';
import type { MaterialSymbol } from '../ui/Icon';
import {
  GROUND_MODES,
  type GroundControls,
  type GroundMode,
} from './useGroundControls';

// What each ground is a picture of, rather than what service draws it: the
// landform, the map of it, the photograph of it.
const GROUND_ICON: Record<GroundMode, MaterialSymbol> = {
  lidar: 'landscape',
  kart: 'map',
  flyfoto: 'photo_camera',
};

export const GroundSwitch = ({ ground }: { ground: GroundControls }) => {
  const { t } = useTranslation();
  const { mode, select } = ground;

  return (
    <ControlUnit>
      {GROUND_MODES.map((candidate) => (
        // The name and then what it is of: the glyph carries the subject but
        // not which service draws it or how far it reaches.
        <Tooltip
          key={candidate}
          label={t('grounds.tooltip', {
            ground: t(`grounds.${candidate}.name`),
            hint: t(`grounds.${candidate}.hint`),
          })}
        >
          <ControlButton
            icon={GROUND_ICON[candidate]}
            on={candidate === mode}
            aria-label={t(`grounds.${candidate}.name`)}
            aria-pressed={candidate === mode}
            onClick={() => select(candidate)}
          />
        </Tooltip>
      ))}
    </ControlUnit>
  );
};
