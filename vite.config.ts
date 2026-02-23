import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import aurelia from '@aurelia/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    open: !process.env.CI,
    port: 9000,
  },
  esbuild: {
    target: 'es2022'
  },
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
  },
  plugins: [
    aurelia({
      useDev: true,
    }),
    tailwindcss(),
    nodePolyfills(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024, // 60 MB
      },
      manifest: false, // Use public/manifest.json directly
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
