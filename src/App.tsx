import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { pbAuthSyncEffect } from './auth/atoms.ts';
import { HelpPage } from './help/HelpPage.tsx';
import './i18n';
import { LidarExtractViewer } from './lidarExtract/LidarExtractViewer.tsx';
import { useMapSettings } from './map/mapHooks.ts';
import { AppShell } from './shell/AppShell.tsx';

export const App = () => {
  const { setMapFullScreen } = useMapSettings();

  // PocketBase authStore → currentUserAtom. Mounted above the router: the
  // shell is only on "/", and signing in must not depend on which route
  // happens to be showing.
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

  return (
    <>
      <LidarExtractViewer />
      <Routes>
        <Route path="/" element={<AppShell />} />
        <Route path="/hjelp" element={<HelpPage />} />
      </Routes>
    </>
  );
};

export default App;
