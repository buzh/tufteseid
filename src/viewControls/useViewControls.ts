

import { useAtomValue, useSetAtom } from 'jotai';
import { selectViewModeAtom } from '../map/compare/atoms';
import { viewModeAtom } from '../map/compare/halves';

export const useViewControls = () => {
  const mode = useAtomValue(viewModeAtom);
  const select = useSetAtom(selectViewModeAtom);

  return { mode, select };
};

export type ViewControls = ReturnType<typeof useViewControls>;
