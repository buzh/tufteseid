// What is drawn over the ground: the heritage register, the open spot's own
// drawing and everybody's at once. Beside the view control rather than among
// the tools, because none of it belongs to one half.

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
