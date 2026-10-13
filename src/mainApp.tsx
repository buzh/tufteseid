import { MantineProvider } from '@mantine/core';
import '@fontsource/mulish/latin-400.css';
import '@fontsource/mulish/latin-500.css';
import '@fontsource/mulish/latin-600.css';
import '@fontsource/mulish/latin-700.css';

import '@mantine/core/styles.css';
import 'material-symbols/rounded.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { projInit } from './map/projections/proj/projInit.ts';
import { theme } from './ui/theme.ts';
import { applyStoredUiScale } from './ui/uiScale.ts';
projInit();
applyStoredUiScale();

const boot = async () => {
  const [{ App }, { AtomWrapper }] = await Promise.all([
    import('./App.tsx'),
    import('./AtomWrapper.tsx'),
  ]);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {}
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <AtomWrapper>
          <App />
        </AtomWrapper>
      </MantineProvider>
    </StrictMode>,
  );
};

void boot();
