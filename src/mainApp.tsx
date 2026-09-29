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

// The app is imported rather than declared at the top for the sake of *when*:
// modules under it take boot values off the address bar as they are
// evaluated, and on the way back from a sign-in the address bar is the
// callback's until `completeSignIn` has put the reader's own back. A static
// import is hoisted above any statement that could do that, so the import
// waits instead.
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
