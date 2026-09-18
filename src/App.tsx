import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { pbAuthSyncEffect } from './auth/atoms.ts';
import './i18n';
import { useMapSettings } from './map/mapHooks.ts';
import { AppShell } from './shell/AppShell.tsx';

export const App = () => {
  const { setMapFullScreen } = useMapSettings();

  useAtom(pbAuthSyncEffect);

  const fullscreenClickHandler = (event: KeyboardEvent) => {
    if (event.key === 'F11') {
      event.preventDefault();
      setMapFullScreen(true);
      event.stopPropagation();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', fullscreenClickHandler);
    return () => {
      document.removeEventListener('keydown', fullscreenClickHandler);
    };
  });

  return <AppShell />;
};

export default App;
