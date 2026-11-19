import './polyfills';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initI18n } from './i18n';
import { initDesktop } from './lib/desktop';
import { useSettings } from './store/settings';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);

// Language resources load asynchronously; the UI re-renders when they arrive.
void initI18n(useSettings.getState().language);

// In the desktop app this wires "Open with PDFCut" and file-manager actions; in the browser it does nothing.
void initDesktop();

requestAnimationFrame(() => performance.mark('pdfcut:ready'));
