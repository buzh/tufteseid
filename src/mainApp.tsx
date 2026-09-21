import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Self-hosted, and only the four weights the UI kit asks for.
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

// Module scope: constructing it in the element tree would throw the whole
// query cache away on any root re-render.
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* `index.html` carries the same value on <html>, so the first paint is
        already dark — see the comment there. */}
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <AtomWrapper>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </AtomWrapper>
    </MantineProvider>
  </StrictMode>,
);
