import { ControlUnit } from '../ui/ControlUnit';
import { SpotMenu } from './SpotMenu';
import { SpotToggle } from './SpotToggle';

export const SpotControlGroup = () => (
  <ControlUnit>
    <SpotToggle />
    <SpotMenu />
  </ControlUnit>
);
