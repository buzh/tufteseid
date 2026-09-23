import { MantineProvider } from '@mantine/core';
import '@fontsource/mulish/latin-400.css';
import '@fontsource/mulish/latin-500.css';
import '@fontsource/mulish/latin-600.css';
import '@fontsource/mulish/latin-700.css';
// Mantine first, so `index.css` and the CSS modules win the cascade against it.
import '@mantine/core/styles.css';
import 'material-symbols/rounded.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AtomWrapper } from './AtomWrapper.tsx';
import './index.css';
import { projInit } from './map/projections/proj/projInit.ts';
import { theme } from './ui/theme.ts';
projInit();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* `index.html` sets the same value on <html> so the first paint is dark. */}
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <AtomWrapper>
        <App />
      </AtomWrapper>
    </MantineProvider>
  </StrictMode>,
);
