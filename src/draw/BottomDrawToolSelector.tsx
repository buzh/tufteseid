import styles from './Draw.module.css';
import { DrawToolSelector } from './DrawToolSelector';

export const BottomDrawToolSelector = () => (
  <div className={styles.bottomBar}>
    <DrawToolSelector />
  </div>
);
