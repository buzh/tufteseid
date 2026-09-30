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
import { completeSignIn, isSignInReturn } from './auth/trip.ts';
import './index.css';
import { projInit } from './map/projections/proj/projInit.ts';
import { theme } from './ui/theme.ts';
projInit();

// Imported dynamically for the sake of ordering: modules under `App` take
// boot values off the address bar as they are evaluated, and until
// `completeSignIn` runs that address bar is the callback's. A static import
// would be hoisted above it.
const boot = async () => {
  if (isSignInReturn()) await completeSignIn();

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
