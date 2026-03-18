import { resolve } from 'node:path'
import aurelia from '@aurelia/vite-plugin'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
	server: {
		open: !process.env.CI,
		port: 9000,
		strictPort: true,
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
		alias: {
			// Stub for unpublished BSR proto types — remove after BSR release
			'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js':
				resolve(__dirname, 'tmp/ticket-journey-stub.js'),
			'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js':
				resolve(__dirname, 'tmp/ticket-journey-stub.js'),
			'@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/ticket_journey/v1/ticket_journey_service_connect.js':
				resolve(__dirname, 'tmp/ticket-journey-stub.js'),
		},
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
