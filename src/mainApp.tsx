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
import './index.css';
import { projInit } from './map/projections/proj/projInit.ts';
import { theme } from './ui/theme.ts';
projInit();

// Imported dynamically for the sake of ordering: the map modules under `App`
// register projections as they are evaluated, so `projInit` has to have run
// first. A static import would be hoisted above it.
const boot = async () => {
  const [{ App }, { AtomWrapper }] = await Promise.all([
    import('./App.tsx'),
    import('./AtomWrapper.tsx'),
  ]);

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
};

void boot();
