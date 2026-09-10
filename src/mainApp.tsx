import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Self-hosted, and only the four weights the UI kit actually asks for — the
// font used to arrive through kvib's theme, which shipped the whole family.
import '@fontsource/mulish/latin-400.css';
import '@fontsource/mulish/latin-500.css';
import '@fontsource/mulish/latin-600.css';
import '@fontsource/mulish/latin-700.css';
import 'material-symbols/rounded.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AtomWrapper } from './AtomWrapper.tsx';
import './index.css';
import { projInit } from './map/projections/proj/projInit.ts';
import { Toaster } from './ui';
projInit();

// Module scope, not inline in the element tree: constructing it there
// makes any root re-render throw the whole query cache away.
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AtomWrapper>
        <QueryClientProvider client={queryClient}>
          <App />
          <Toaster />
        </QueryClientProvider>
      </AtomWrapper>
    </BrowserRouter>
  </StrictMode>,
);
