import { useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { mapAtom } from './atoms';

const useMap = () => {
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

  const mapElement = map.getTarget() as HTMLElement | undefined;
  return { mapElement, setTargetElement };
};

export { useMap };
