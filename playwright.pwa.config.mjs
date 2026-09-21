import { defineConfig, devices } from '@playwright/test'

/**
 * Dedicated Playwright config for PWA / service-worker tests.
 *
 * These specs are the only ones that MUST run against a production build.
 * `vite.config.ts` sets the vite-plugin-pwa `devOptions.enabled: false`, so the
 * dev server registers no service worker at all — running them against `npm
 * start` (the main config's server) exercises nothing, and an offline
 * assertion there passes or fails for reasons unrelated to caching. That is how
 * `pwa-offline-cache.spec.ts` came to be excluded from CI with an inaccurate
 * reason ("not available in CI headless").
 *
 * Kept as a separate config, following `playwright.smoke.config.mjs`, so the
 * `npm run build` this needs does not run on every ordinary e2e invocation.
 *
 * Usage:
 *   npx playwright test --config=playwright.pwa.config.mjs
 */
export default defineConfig({
	testDir: './e2e/pwa',
	testIgnore: [
		// Requires auth storageState — covered by the `authenticated` project in
		// the main config.
		'pwa-settings.spec.ts',
		// Requires `beforeinstallprompt`, which Chromium only fires once its
		// install heuristics are satisfied. Headless CI never satisfies them and
		// Playwright exposes no way to synthesise the event. KNOWN GAP:
		// vite-plugin-pwa manifest behaviour has no pipeline coverage — see
		// docs/ci-coverage-gaps.md.
		'pwa-install-prompt.spec.ts',
	],
	timeout: 60 * 1000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'list',

	use: {
		actionTimeout: 0,
		trace: 'on-first-retry',
		baseURL: 'http://localhost:9100',
	},

	projects: [
		{
			name: 'pwa',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	outputDir: 'test-results/pwa/',

	// `vite preview` over `dist/`, where the injectManifest service worker
	// actually exists. The build is part of the command because the preview
	// server serves whatever `dist/` already holds, which would otherwise be
	// a stale or absent bundle.
	webServer: {
		command: 'npm run build && npm run preview',
		port: 9100,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
})
