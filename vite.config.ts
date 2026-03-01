import aurelia from '@aurelia/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
	server: {
		open: !process.env.CI,
		port: 9000,
		proxy: {
			'/liverty_music': {
				target: 'https://api.dev.liverty-music.app',
				changeOrigin: true,
				secure: true,
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
})
