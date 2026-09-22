// The Terrenganalyse surface: the button that computes relief over a square of
// ground, and — only while it is computing — the chip that says what of it.
//
// Two shapes rather than one, for the reason the Kulturminner pair has two.
// Whether the analysis is running at all is a press with nothing to read, and
// it is asked often, because it is the expensive thing on the page. Which
// visualization, in what light, at what radius is asked while looking at the
// result.
//
// One control, though, so they stand in a `ControlUnit`: the chip is a readout
// of what the button started — the picture it is drawing, and how far along the
// fetch behind it is — and a gap between them would make the two read as
// unrelated neighbours in a band whose other members genuinely are.

import { ControlUnit } from '../ui/ControlUnit';
import { TerrainMenu } from './TerrainMenu';
import { TerrainToggle } from './TerrainToggle';
import type { TerrainControls } from './useTerrainControls';

export const TerrainControlGroup = ({
  terrain,
}: {
  terrain: TerrainControls;
}) => (
  <ControlUnit>
    <TerrainToggle terrain={terrain} />
    {terrain.on && <TerrainMenu terrain={terrain} />}
  </ControlUnit>
);
