import {
  HeritageMenu,
  HeritageToggle,
  useHeritageControls,
} from '../heritageControls';
import { ControlUnit } from '../ui/ControlUnit';
import { AllSketchesToggle } from './AllSketchesToggle';
import { SketchToggle } from './SketchToggle';

export const ShowControlGroup = () => {
  const heritage = useHeritageControls();

  return (
    <ControlUnit>
      <HeritageToggle heritage={heritage} />
      <HeritageMenu heritage={heritage} />
      <SketchToggle />
      <AllSketchesToggle />
    </ControlUnit>
  );
};
