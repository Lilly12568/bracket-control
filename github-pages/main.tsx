import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import BracketControl from '../app/page';
import '../app/globals.css';

document.documentElement.style.setProperty(
  '--font-geist-sans',
  'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
);
document.documentElement.style.setProperty(
  '--font-geist-mono',
  '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
);

const root = document.getElementById('root');

if (!root) throw new Error('The GitHub Pages root element is missing.');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', baseUrl), {
      scope: baseUrl.pathname,
    });
  }, { once: true });
}

createRoot(root).render(
  <StrictMode>
    <BracketControl />
  </StrictMode>,
);
