import { useAtomValue } from 'jotai';
import { compareOnAtom } from '../map/compare/halves';
import { uiContextAtom } from '../shared/uiContext';
import { cx } from '../ui/cx';
import { DrawBand } from './DrawBand';
import { GroundSection } from './GroundSection';
import styles from './Ribbon.module.css';
import { ToolSection } from './ToolSection';
import { ViewSection } from './ViewSection';

export const Ribbon = () => {
  const context = useAtomValue(uiContextAtom);
  const twoGrounds = useAtomValue(compareOnAtom);
  const drawing = context === 'draw';

  return (
    <>
      {}
      <header className={cx(styles.ribbon, drawing && styles.away)}>
        <div className={styles.side}>
          <GroundSection half="a" />
        </div>
        <ViewSection />
        <div className={styles.side}>
          {twoGrounds && <GroundSection half="b" />}
          <ToolSection />
        </div>
      </header>
      {drawing && <DrawBand />}
    </>
  );
};
