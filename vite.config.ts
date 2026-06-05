import { fileURLToPath } from 'node:url'
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
		// Default-open targets the consumer entry (index.html). The admin entry
		// is reachable at /admin.html on the same dev server.
		open: process.env.CI ? false : '/index.html',
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
	build: {
		rollupOptions: {
			// Two HTML entry points → two independent Rollup chunk graphs. The
			// consumer (`main`) graph never references admin-only modules, so the
			// fan-facing bundle does not grow (design D2; verified post-build by
			// scripts/verify-bundle-isolation.ts). A single `npm run build`
			// emits both entries into dist/.
			input: {
				main: fileURLToPath(new URL('./index.html', import.meta.url)),
				admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
			},
			output: {
				// Route admin-EXCLUSIVE chunks/assets into `assets/admin/` so the
				// consumer SW precache (and any name-based tooling) can exclude the
				// whole admin graph with a single `assets/admin/**` glob. Chunks
				// shared by BOTH entries (e.g. the OIDC AuthService / config loader
				// from shared/) stay in `assets/` — the consumer already loads
				// them, so they belong in its precache. A chunk is admin-exclusive
				// when every one of its module ids lives under the admin/ source
				// root (no module shared with the consumer graph).
				chunkFileNames: (chunkInfo) => {
					const ids = chunkInfo.moduleIds ?? []
					const adminOnly =
						ids.length > 0 &&
						ids.every((id) => /\/admin\/[^/]/.test(id.replace(/\\/g, '/')))
					return adminOnly
						? 'assets/admin/[name]-[hash].js'
						: 'assets/[name]-[hash].js'
				},
				assetFileNames: (assetInfo) => {
					const src = (assetInfo.originalFileNames ?? []).join('|')
					const fromAdmin = /(^|\/)admin\//.test(src.replace(/\\/g, '/'))
					return fromAdmin
						? 'assets/admin/[name]-[hash][extname]'
						: 'assets/[name]-[hash][extname]'
				},
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
			// The plugin defaults to `src/**/*.{ts,js,html}`. Extend it so the
			// admin entry's components (under `admin/`) and any shared components
			// (under `shared/`) also get convention pairing + template compilation;
			// without this, admin `.html`/`.css` are never compiled into their
			// chunks and the admin views render empty.
			include: ['src/**/*.{ts,js,html}', 'admin/**/*.{ts,js,html}', 'shared/**/*.{ts,js,html}'],
		}),
		nodePolyfills(),
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'sw.ts',
			injectManifest: {
				maximumFileSizeToCacheInBytes: 60 * 1024 * 1024, // 60 MB
				// Scope the precache manifest to the consumer entry. The admin
				// entry ships NO service worker and must never enter the consumer
				// SW precache (design "Risks" — PWA over-precaching). All
				// admin-exclusive output lands in `assets/admin/` (see the
				// rollupOptions.output filename functions above) plus the entry
				// `admin.html` and its `admin-*` entry chunk, so a single glob set
				// excludes the entire admin graph. Shared chunks the consumer also
				// loads stay in `assets/` and remain precached, as intended.
				globIgnores: [
					'**/admin.html',
					'**/admin/**',
					'assets/admin-*.js',
					'assets/admin-*.css',
				],
			},
			manifest: false, // Use public/manifest.json directly
			devOptions: {
				enabled: false,
			},
		}),
	],
})
