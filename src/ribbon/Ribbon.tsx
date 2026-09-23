import { useAtomValue } from 'jotai';
import { compareOnAtom } from '../map/compare/halves';
import { GroundSection } from './GroundSection';
import styles from './Ribbon.module.css';
import { ToolSection } from './ToolSection';
import { ViewSection } from './ViewSection';

export const Ribbon = () => {
  const twoGrounds = useAtomValue(compareOnAtom);

  return (
    <header className={styles.ribbon}>
      <div className={styles.side}>
        <GroundSection half="a" />
      </div>
      <ViewSection />
      <div className={styles.side}>
        {twoGrounds && <GroundSection half="b" />}
        <ToolSection />
      </div>
    </header>
  );
};
