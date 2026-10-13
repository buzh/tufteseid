import { useEffect } from 'react';
import { ControlUnit } from '../ui/ControlUnit';
import { AutoToggle } from './AutoToggle';
import { DatasetMenu } from './DatasetMenu';
import { HybridToggle } from './HybridToggle';
import { ModelToggle } from './ModelToggle';
import { RenderMenu } from './RenderMenu';
import { ZoomReadout } from './ZoomReadout';
import type { LidarControls } from './useLidarControls';

export const LidarControlGroup = ({ lidar }: { lidar: LidarControls }) => {
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
      <ZoomReadout lidar={lidar} />
    </ControlUnit>
  );
};
