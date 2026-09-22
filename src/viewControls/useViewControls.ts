// The view arm's controller: how many grounds are on the screen, and in what
// shape. One axis, three values, and the whole of it is `viewModeAtom`.
//
// Thin on purpose — the work of changing view is not the reader's choice but
// what the B half has to be seeded with, and that lives in `selectViewModeAtom`
// (`src/map/compare/atoms.ts`) beside the layer code it writes. Unlike the
// ground arms there is one of these for the whole band: a view is a property of
// the map, not of a half.

import { useAtomValue, useSetAtom } from 'jotai';
import { selectViewModeAtom } from '../map/compare/atoms';
import { viewModeAtom } from '../map/compare/halves';

export const useViewControls = () => {
  const mode = useAtomValue(viewModeAtom);
  const select = useSetAtom(selectViewModeAtom);

  return { mode, select };
};

export type ViewControls = ReturnType<typeof useViewControls>;
