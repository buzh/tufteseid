import './i18n';
import styles from './App.module.css';
import { MapComponent } from './map/MapComponent.tsx';
import { Ribbon } from './ribbon/Ribbon.tsx';

// The first surface over the map: a ribbon that says which ground is drawing —
// LiDAR relief, one of Kartverket's map series, or ortofoto — and which dataset
// within it, and switches both. Everything below MapComponent — the grounds,
// the WMS stacks, the tile cache in front of them — is driven by atoms, so the
// ribbon writes atoms and rebuilds nothing itself.
export const App = () => (
  <div className={styles.shell}>
    <Ribbon />
    <div className={styles.map}>
      <MapComponent />
    </div>
  </div>
);

export default App;
