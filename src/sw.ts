/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache app shell assets injected by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST);

// Cache ZK circuit artifacts (.wasm and .zkey) with a long-lived CacheFirst strategy.
registerRoute(
  ({ url }) => url.pathname.endsWith('.wasm') || url.pathname.endsWith('.zkey'),
  new CacheFirst({
    cacheName: 'zk-circuits-v1',
    plugins: [
      new ExpirationPlugin({
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  }),
);
