import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import aurelia from '@aurelia/vite-plugin'
import { defineConfig, type Plugin } from 'vite'

/**
 * Build of the reception app, served on its own origin (`reception.<domain>`)
 * by the `reception-web` image (Dockerfile.reception). See OpenSpec change
 * `isolate-venue-reception`, design D4.
 *
 * It is a separate build, not an input of the main `vite.config.ts`: its only
 * input is `reception.html` and its output directory is `dist-reception/`, so
 * the output holds only what the reception screen reaches (plus the shared/
 * modules it imports from source). `npm run verify:reception-bundle` checks
 * after the build that no OIDC client or console code got in, and reports the
 * output size.
 */

const fromRoot = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url))

/**
 * The site icons `reception.html` links to, shared with the other entries.
 * (`favicon.ico` is not listed: Vite bundles it from the repository root.)
 */
const ICONS = ['favicon-96x96.png', 'apple-touch-icon.png']

/**
 * Copies the site icons from the consumer `public/` into the output. The
 * reception `publicDir` holds only its own `config.json`, so the rest of the
 * consumer public files (manifest, consumer config) never reach this origin.
 */
function receptionIcons(): Plugin {
	return {
		name: 'reception-icons',
		apply: 'build',
		generateBundle() {
			for (const fileName of ICONS) {
				this.emitFile({
					type: 'asset',
					fileName,
					source: readFileSync(fromRoot(`./public/${fileName}`)),
				})
			}
		},
	}
}

export default defineConfig({
	// The bundled `config.json` is the prod reception config; each environment's
	// pod mounts its own over it at the same path.
	publicDir: fromRoot('./reception/public'),
	build: {
		outDir: fromRoot('./dist-reception'),
		emptyOutDir: true,
		rollupOptions: {
			input: {
				reception: fromRoot('./reception.html'),
			},
		},
	},
	// The QR decoder's ZXing WebAssembly runs in a module Web Worker.
	worker: {
		format: 'es',
	},
	esbuild: {
		target: 'es2022',
	},
	resolve: {
		conditions: ['browser', 'import', 'module', 'default'],
	},
	plugins: [
		aurelia({
			// Same as the main build, so the reception screen behaves as before.
			useDev: true,
			include: ['reception/**/*.{ts,js,html}', 'shared/**/*.{ts,js,html}'],
		}),
		receptionIcons(),
	],
})
