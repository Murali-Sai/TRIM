import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { fetchHealth } from './api/health';
import { App } from './App';
// Self-hosted fonts (SIL OFL 1.1): Fira Sans for text, Fira Code for numbers.
import '@fontsource/fira-sans/400.css';
import '@fontsource/fira-sans/500.css';
import '@fontsource/fira-sans/600.css';
import '@fontsource/fira-sans/700.css';
import '@fontsource-variable/fira-code';
import './index.css';

const queryClient = new QueryClient();

// Wake the API early so a Cloud Run cold start overlaps with page load.
fetchHealth().catch(() => undefined);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
