import { Group } from '@mantine/core';
import { useViewControls, ViewControlGroup } from '../viewControls';

export const ViewSection = () => {
  const view = useViewControls();

  return (
    <Group gap="xs" wrap="nowrap">
      <ViewControlGroup view={view} />
    </Group>
  );
};
