import { useEffect } from 'react';
import { ControlUnit } from '../ui/ControlUnit';
import { AutoToggle } from './AutoToggle';
import { DatasetMenu } from './DatasetMenu';
import { HybridToggle } from './HybridToggle';
import { ModelToggle } from './ModelToggle';
import { RenderMenu } from './RenderMenu';
import type { LidarControls } from './useLidarControls';

export const LidarControlGroup = ({ lidar }: { lidar: LidarControls }) => {
  // The picker atom is shared with the map and an unmount never fires the
  // dataset menu's close callback; left open, the map keeps painting footprints.
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
