import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Dedicated vitest config for `scripts/` tests.
 *
 * The main `vitest.config.ts` inherits the SPA's vite config, which
 * includes `vite-plugin-node-polyfills` to support snarkjs and other
 * browser-bundled deps. That polyfill rewrites `node:fs` / `node:os` /
 * `node:path` to browser-stdlib shims, which makes Node-native APIs
 * (`mkdtempSync`, `rmSync`, etc.) inaccessible to scripts tests.
 *
 * This config explicitly does NOT extend `vite.config.ts` — it ships
 * the bare-minimum vitest setup so `node:*` imports resolve to the
 * real Node modules. Run via `npm run test:scripts`.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['scripts/**/*.spec.ts'],
		watch: false,
		root: fileURLToPath(new URL('./', import.meta.url)),
	},
})
