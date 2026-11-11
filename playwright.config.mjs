import { defineConfig, devices } from '@playwright/test'
import { APP_ORIGIN, E2E_PORT } from './e2e/support/app-origin.ts'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: './e2e',
	/* Maximum time one test can run for. */
	timeout: 30 * 1000,
	expect: {
		/**
		 * Maximum time expect() should wait for the condition to be met.
		 * For example in `await expect(locator).toHaveText();`
		 */
		timeout: 5000,
	},
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Playwright's default (half the logical CPUs) on CI too. The scaffold's
	 * `workers: 1` ran 346 tests serially for ~8 minutes while `fullyParallel`
	 * runs them in parallel locally (cloud-provisioning#666). */
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: 'html',
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
		actionTimeout: 0,
		/* Base URL to use in actions like `await page.goto('/')`. */
		// baseURL: 'http://localhost:3000',

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: 'on-first-retry',
	},

	projects: [
		// Layer 3: E2E Functional — user journeys (Desktop Chrome)
		{
			name: 'functional',
			testMatch: 'e2e/functional/**/*.spec.ts',
			testIgnore: [
				// Covered by onboarding project (Pixel 7 viewport)
				'e2e/functional/onboarding-flow.spec.ts',
				'e2e/functional/detail-sheet-dismiss.spec.ts',
				'e2e/functional/dashboard-lane-classification.spec.ts',
				'e2e/functional/artist-image-ui.spec.ts',
				// Covered by webkit-repro / chromium-control projects (engine-specific)
				'e2e/functional/page-help-sheet-webkit.spec.ts',
				// Covered by the typefaces-* projects (phone profiles)
				'e2e/functional/typefaces.spec.ts',
			],
			use: {
				...devices['Desktop Chrome'],
				baseURL: APP_ORIGIN,
			},
		},
		// WebKit regression guard: real WebKit engine, iPhone 14 viewport.
		// RED before the bottom-sheet dismiss fix, GREEN after.
		// Requires the WebKit browser to be installed:
		//   npx @playwright/mcp install-browser chrome-for-testing  (or `npx playwright install webkit`)
		{
			name: 'webkit-repro',
			testMatch: 'e2e/functional/page-help-sheet-webkit.spec.ts',
			use: {
				...devices['iPhone 14'],
				browserName: 'webkit',
				baseURL: APP_ORIGIN,
			},
		},
		// Chromium control for the WebKit regression guard: same viewport, Chromium engine.
		// Must stay GREEN before and after the fix (proves the fix doesn't break Chromium).
		{
			name: 'chromium-control',
			testMatch: 'e2e/functional/page-help-sheet-webkit.spec.ts',
			use: {
				...devices['iPhone 14'],
				browserName: 'chromium',
				baseURL: APP_ORIGIN,
			},
		},
		// The shell chrome (bottom navigation, page header, FAB) on the real WebKit
		// engine, iPhone 14 viewport: the notch mask, offset-path arc and top-layer
		// FAB must hold on Safari as well as on Chromium (`functional`).
		{
			name: 'webkit-shell',
			testMatch: [
				'e2e/functional/fan-shell-navigation.spec.ts',
				'e2e/functional/fab-menu-arc.spec.ts',
				'e2e/functional/fab-menu-top-layer.spec.ts',
				// The timetable's deal-in without scroll-triggered animations.
				'e2e/functional/deal-in.spec.ts',
				// The month jump without scroll-state queries.
				'e2e/functional/month-jump.spec.ts',
				// Safari downloads Noto Sans JP: it draws no local() Noto.
				'e2e/functional/local-noto.spec.ts',
			],
			// Only the tests whose outcome depends on the engine carry `@webkit`
			// (the notch mask, the offset-path arc, the top layer, Safari's fonts
			// and its missing scroll-driven features); the rest run in `functional`.
			grep: /@webkit/,
			use: {
				...devices['iPhone 14'],
				browserName: 'webkit',
				baseURL: APP_ORIGIN,
			},
		},
		// The virtual ticket on the real WebKit engine, iPhone 14 viewport: Safari
		// on iOS is a supported browser, the owner has no iPhone, and the share
		// image's SVG foreignObject export behaves differently on WebKit. Chromium
		// runs the same spec in `functional`.
		{
			name: 'webkit-virtual-ticket',
			testMatch: 'e2e/functional/virtual-ticket.spec.ts',
			use: {
				...devices['iPhone 14'],
				browserName: 'webkit',
				baseURL: APP_ORIGIN,
			},
		},
		// The organizer members' guide and the console's 使い方 on the real WebKit
		// engine, iPhone 14 viewport: the guide spec asks for the browsers the
		// console supports, Safari on iOS among them, and `functional` runs only
		// Chromium. Only the phone checks run here.
		{
			name: 'webkit-organizer-guide',
			testMatch: 'e2e/functional/organizer-guide.spec.ts',
			grep: /"Opened on a phone"|"Help on a phone"/,
			use: {
				...devices['iPhone 14'],
				browserName: 'webkit',
				baseURL: APP_ORIGIN,
			},
		},
		// The fan app's typefaces as drawn, on the two phone profiles the
		// design-tokens spec names. Both run Chromium: only its DevTools protocol
		// reports which font drew each glyph.
		{
			name: 'typefaces-pixel7',
			testMatch: 'e2e/functional/typefaces.spec.ts',
			use: {
				...devices['Pixel 7'],
				baseURL: APP_ORIGIN,
			},
		},
		{
			name: 'typefaces-iphone',
			testMatch: 'e2e/functional/typefaces.spec.ts',
			use: {
				...devices['iPhone 14'],
				browserName: 'chromium',
				baseURL: APP_ORIGIN,
			},
		},
		// Layer 3: E2E Functional — onboarding flows (Pixel 7 mobile)
		{
			name: 'onboarding',
			testMatch: [
				'e2e/functional/onboarding-flow.spec.ts',
				'e2e/functional/detail-sheet-dismiss.spec.ts',
				'e2e/functional/dashboard-lane-classification.spec.ts',
				'e2e/functional/artist-image-ui.spec.ts',
			],
			use: {
				...devices['Pixel 7'],
				baseURL: APP_ORIGIN,
			},
		},
		// Layer 3: Smoke — console error detection
		{
			name: 'smoke',
			testMatch: 'e2e/smoke/**/*.spec.ts',
			// post-deploy.spec.ts runs from playwright.smoke.config.mjs against
			// a live URL — exclude here so it never picks up the local dev
			// server's baseURL.
			testIgnore: 'e2e/smoke/post-deploy.spec.ts',
			use: {
				...devices['Desktop Chrome'],
				baseURL: APP_ORIGIN,
			},
		},
		// Visual regression has moved to component-level Storybook browser tests
		// (Vitest `toMatchScreenshot`, `npm run test-storybook`). The page-level
		// Playwright `mobile-visual` / `authenticated-visual` projects and their
		// `e2e/visual/**` specs were retired to keep a single visual-regression
		// pipeline (OpenSpec `adopt-storybook-component-testing`). Page-level route
		// composition remains covered by the functional/smoke e2e projects.
		// Layer 5: PWA — service worker tests.
		// These live in `playwright.pwa.config.mjs`, NOT here: they must run
		// against a production build (`vite preview`), because vite-plugin-pwa
		// disables the service worker in dev. Running them against this config's
		// dev server would verify nothing. See that file for the known gap.
		// Authenticated E2E (non-visual).
		//
		// NOT RUN IN CI, and cannot be: `storageState` is produced by
		// `npm run auth:capture:password`, which drives a real OIDC login against
		// the dev Zitadel using a credential held in ESC. CI has no way to obtain
		// it, and `.auth/` is gitignored.
		//
		// KNOWN GAP: pwa-settings.spec.ts is the only spec this project owns, so
		// the push-notification settings surface has no pipeline coverage. Note
		// that the spec stubs `navigator.serviceWorker` wholesale, so it would not
		// constitute workbox coverage even if it did run — that is covered by
		// playwright.pwa.config.mjs instead.
		{
			name: 'authenticated',
			testMatch: 'e2e/pwa/pwa-settings.spec.ts',
			use: {
				...devices['Desktop Chrome'],
				storageState: '.auth/storageState.json',
			},
		},
	],

	/* Folder for test artifacts such as screenshots, videos, traces, etc. */
	outputDir: 'test-results/',

	/* Run your local dev server before starting the tests. The post-deploy
     smoke spec runs from a dedicated config (playwright.smoke.config.mjs)
     so it never starts a webServer — this file is for local-dev / CI
     tests only. */
	webServer: {
		/* `--strictPort`: if E2E_PORT is taken, vite exits instead of moving to
       another port that Playwright would never find. */
		command: `npm start -- --port ${E2E_PORT} --strictPort`,
		port: E2E_PORT,
		reuseExistingServer: !process.env.CI,
	},
})
