import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { mapAtom } from './atoms';

export const useMap = () => {
  const map = useAtomValue(mapAtom);

  const setTargetElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (!map.getTarget() && element) {
        map.setTarget(element);
      } else if (element == null) {
        map.setTarget(undefined);
      }
    },
    [map],
  );

  return { setTargetElement };
};
