import './i18n';
import { useAtom } from 'jotai';
import styles from './App.module.css';
import { AuthDialog, pbAuthSyncEffect } from './auth';
import { MapComponent } from './map/MapComponent.tsx';
import { Ribbon } from './ribbon/Ribbon.tsx';

export const App = () => {
  // Mirrors PocketBase's authStore into `currentUserAtom`; mounted here because
  // several surfaces read it.
  useAtom(pbAuthSyncEffect);

  return (
    <div className={styles.shell}>
      <Ribbon />
      <div className={styles.map}>
        <MapComponent />
      </div>
      <AuthDialog />
    </div>
  );
};

export default App;
