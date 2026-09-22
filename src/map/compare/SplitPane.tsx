// The right half of the split view: a viewport for the second OL map.
//
// Nothing but a target. The map is a module singleton (`splitMap.ts`) sharing
// the main map's `View` object, so the two are centred on the same coordinate
// at the same resolution by construction, and dragging either one moves both.
// Mounted only while the split is the view; unmounting releases the target, and
// an OL map with no target renders nothing but keeps its layers.

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
