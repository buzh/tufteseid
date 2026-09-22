import './i18n';
import { useAtom } from 'jotai';
import styles from './App.module.css';
import { AuthDialog, pbAuthSyncEffect } from './auth';
import { MapComponent } from './map/MapComponent.tsx';
import { Ribbon } from './ribbon/Ribbon.tsx';

// The first surface over the map: a ribbon that says which ground is drawing —
// LiDAR relief, one of Kartverket's map series, or ortofoto — and which dataset
// within it, and switches both. Everything below MapComponent — the grounds,
// the WMS stacks, the tile cache in front of them — is driven by atoms, so the
// ribbon writes atoms and rebuilds nothing itself.
export const App = () => {
  // Mirrors PocketBase's authStore into `currentUserAtom`. At the root because
  // who is signed in is not a property of any one surface: the band reads it,
  // the spot layer reads it, and the dialog below writes it.
  useAtom(pbAuthSyncEffect);

  return (
    <div className={styles.shell}>
      <Ribbon />
      <div className={styles.map}>
        <MapComponent />
      </div>
      {/* At the root rather than inside a surface: the band's account button
          opens it, and so does any verb that turns out to need an account. */}
      <AuthDialog />
    </div>
  );
};

export default App;
