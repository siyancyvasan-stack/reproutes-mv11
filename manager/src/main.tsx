import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Registration is deliberately production-only. Also remove a service worker
// left behind by an older production build when running the Vite dev server;
// otherwise it can intercept API requests and return stale/500 responses.
if (!import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister()))
    );
    if ('caches' in window) {
      void window.caches.keys().then((keys) =>
        Promise.all(keys.map((key) => window.caches.delete(key)))
      );
    }
  });
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {
        // Installation support is progressive enhancement; a restricted browser
        // profile must still be able to use the web application normally.
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
