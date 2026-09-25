import { Group } from '@mantine/core';
import { ShowControlGroup } from '../showControls';
import { useViewControls, ViewControlGroup } from '../viewControls';

export const ViewSection = () => {
  const view = useViewControls();

  return (
    <Group gap="xs" wrap="nowrap">
      <ViewControlGroup view={view} />
      <ShowControlGroup />
    </Group>
  );
};
