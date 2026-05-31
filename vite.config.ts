import aurelia from '@aurelia/vite-plugin'
import { defineConfig, loadEnv } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

// Where the dev server proxies `/liverty_music` RPC calls. Defaults to the dev
// cloud backend; override in a gitignored `.env.local` with
// `VITE_DEV_API_TARGET=http://localhost:8080` to hit a local backend. Loaded at
// top level (not via the callback config form) so `vitest.config.ts` can still
// `mergeConfig` this as a plain object.
const env = loadEnv(
	process.env.NODE_ENV ?? 'development',
	process.cwd(),
	'VITE_',
)
const devApiTarget =
	env.VITE_DEV_API_TARGET || 'https://api.dev.liverty-music.app'

export default defineConfig({
	server: {
		open: !process.env.CI,
		port: 9000,
		strictPort: true,
		proxy: {
			'/liverty_music': {
				target: devApiTarget,
				changeOrigin: true,
				secure: devApiTarget.startsWith('https'),
			},
		},
	},
	esbuild: {
		target: 'es2022',
	},
	resolve: {
		conditions: ['browser', 'import', 'module', 'default'],
	},
	plugins: [
		aurelia({
			useDev: true,
		}),
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
})
