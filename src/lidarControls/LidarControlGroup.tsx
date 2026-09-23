// The LiDAR arm: five controls drawn as one box.
//
// Joined rather than spaced. The five are one subject — which relief is on the
// screen — and set a gap apart they read as five neighbours that happen to be
// adjacent, which in a band where the sections themselves are gaps is the wrong
// thing to say. The one gap the ground section keeps is the one before this,
// between the switch and the arm, and that is where the subject actually
// changes: from which ground to what of it. Hybrid stays inside the join even
// though it is written over the relief rather than being it — it exists only on
// this ground, and a second gap would promise a second section.
//
// This is the whole surface, not a convenience wrapper — a host renders this
// and gets the controls and their order rather than reassembling them. It
// assumes LiDAR is the ground: the host mounts it only under `mode === 'lidar'`
// (`src/grounds/`), so there is no off-LiDAR branch in here and no way in from
// one. The order is an argument: Automatisk stands ahead of the
// pair it governs, because with it on both chips are its answer rather than the
// reader's; the dataset comes before the render because a render is only on
// offer where the dataset publishes it; the model sits after them because it is
// the one axis that survives every dataset. Hybrid is last because it is not
// about the relief at all — it is what is written over whichever relief the
// four before it settled on.
//
// It takes the controller rather than calling `useLidarControls` itself, which
// is what lets a two-ground view mount one of these per pane: the controller
// knows which half it writes and nothing in the five controls does.

import { useEffect } from 'react';
import { ControlUnit } from '../ui/ControlUnit';
import { AutoToggle } from './AutoToggle';
import { DatasetMenu } from './DatasetMenu';
import { HybridToggle } from './HybridToggle';
import { ModelToggle } from './ModelToggle';
import { RenderMenu } from './RenderMenu';
import type { LidarControls } from './useLidarControls';

export const LidarControlGroup = ({ lidar }: { lidar: LidarControls }) => {
  // The half's picker atom is shared with the map, and an unmount never fires
  // the dataset menu's own close callback. It hangs off this group rather than
  // off the controller because the group is what comes and goes: the controller
  // outlives a trip to another ground, and a picker left open would have the
  // map painting footprints over that ground and the menu springing open
  // unprompted on the way back.
  const { setPickerOpen, setHoveredProjectId } = lidar;
  useEffect(
    () => () => {
      setPickerOpen(false);
      setHoveredProjectId(null);
    },
    [setPickerOpen, setHoveredProjectId],
  );

  return (
    <ControlUnit>
      <AutoToggle lidar={lidar} />
      <DatasetMenu lidar={lidar} />
      <RenderMenu lidar={lidar} />
      <ModelToggle lidar={lidar} />
      <HybridToggle lidar={lidar} />
    </ControlUnit>
  );
};
