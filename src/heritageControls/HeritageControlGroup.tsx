import { ControlUnit } from '../ui/ControlUnit';
import { HeritageMenu } from './HeritageMenu';
import { HeritageToggle } from './HeritageToggle';
import type { HeritageControls } from './useHeritageControls';

export const HeritageControlGroup = ({
  heritage,
}: {
  heritage: HeritageControls;
}) => (
  <ControlUnit>
    <HeritageToggle heritage={heritage} />
    <HeritageMenu heritage={heritage} />
  </ControlUnit>
);
