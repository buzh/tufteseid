// A viewport for the second OL map, nothing more. Releasing the target on
// unmount stops it rendering but keeps its layers.

import { useEffect, useRef } from 'react';
import styles from './SplitPane.module.css';
import { getSplitMap } from './splitMap';

export const SplitPane = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = getSplitMap();
    map.setTarget(ref.current ?? undefined);
    return () => map.setTarget(undefined);
  }, []);

  return <div ref={ref} className={styles.pane} />;
};
