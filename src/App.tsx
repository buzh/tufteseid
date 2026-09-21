import './i18n';
import { MapComponent } from './map/MapComponent.tsx';

// The interface starts here and there is nothing above the map yet: the old
// shell was taken down with the rest of the UI, and what replaces it is being
// designed. Everything below MapComponent — the grounds, the WMS stacks, the
// tile cache in front of them — is intact and driven by atoms, so a control
// surface is a matter of writing to those atoms rather than rebuilding layers.
export const App = () => <MapComponent />;

export default App;
