// The Flyfoto control surface: the arm, the controller it takes, and the
// controller's type. The period vocabulary in `eras.ts` is not exported —
// it is a filter over this arm's own list and has no reader outside it.
export { FlyfotoControlGroup } from './FlyfotoControlGroup';
export { type FlyfotoControls, useFlyfotoControls } from './useFlyfotoControls';
