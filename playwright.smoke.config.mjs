import { defineConfig, devices } from '@playwright/test'

/**
 * Dedicated Playwright config for post-deploy smoke runs against a live
 * (deployed) URL.
 *
 * Driven by `SMOKE_BASE_URL`. Unlike the main config, this one does NOT
 * declare a `webServer` block — the smoke job must NOT spawn `npm start`
 * in CI, and having a separate config keeps that concern isolated from
 * developer workflows.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://dev.liverty-music.app \
 *     npx playwright test --config=playwright.smoke.config.mjs
 *
 * Or via the npm alias: `npm run test:smoke` (env still required).
 */
export default defineConfig({
	testDir: './e2e/smoke',
	testMatch: 'post-deploy.spec.ts',
	timeout: 60 * 1000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: 'list',

	use: {
		actionTimeout: 0,
		trace: 'on-first-retry',
		baseURL: process.env.SMOKE_BASE_URL,
	},

	projects: [
		{
			name: 'post-deploy',
			use: { ...devices['Desktop Chrome'] },
		},
	],

	outputDir: 'test-results/smoke/',
	// Intentionally no `webServer` — smoke runs target a live deployed URL.
})
