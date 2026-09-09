import { useBreakpointUp } from '../ui/useMediaQuery';

// The mobile/desktop split, on plain matchMedia. This used to be the app's
// only consumer of kvib's useKvibContext + getBreakpointCondition, and thus
// the reason any component that made a responsive decision pulled the whole
// component library in with it.
const useIsMobileScreen = () => !useBreakpointUp('md');

export { useIsMobileScreen };
