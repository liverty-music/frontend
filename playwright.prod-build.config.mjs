import { defineConfig, devices } from '@playwright/test'

/**
 * Rendered checks against the PRODUCTION build (`vite build` + `vite preview`).
 *
 * The functional suites run on the Vite dev server, which injects CSS in
 * import order. Only the production build splits CSS shared between entries
 * into chunks linked before an entry's own CSS, and the first `@layer` the
 * browser reads fixes the cascade order: v1.89.0 shipped with every component
 * style lost while every suite passed. These checks open the public screens of
 * each entry (fan, organizer, admin) and the console screens with mocked RPCs,
 * in light and dark at a phone and a desktop size, and fail on any axe
 * violation and on a component whose own styles are not applied.
 * OpenSpec change `redesign-organizer-console`, design D22.
 *
 * Kept as its own config, like `playwright.pwa.config.mjs`, so the production
 * build it needs does not run on every ordinary e2e invocation.
 *
 * Usage:
 *   npm run test:prod-build
 */
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

const variants = [
	{ name: 'phone-light', viewport: PHONE, colorScheme: 'light' },
	{ name: 'phone-dark', viewport: PHONE, colorScheme: 'dark' },
	{ name: 'desktop-light', viewport: DESKTOP, colorScheme: 'light' },
	{ name: 'desktop-dark', viewport: DESKTOP, colorScheme: 'dark' },
]

export default defineConfig({
	testDir: './e2e/prod-build',
	timeout: 60 * 1000,
	expect: { timeout: 10_000 },
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: 'list',

	use: {
		actionTimeout: 0,
		trace: 'retain-on-failure',
		baseURL: 'http://localhost:9100',
		locale: 'ja-JP',
		timezoneId: 'Asia/Tokyo',
		// The fan entry registers a service worker in the production build. A
		// worker would answer the organizer and admin documents from its
		// precache (bypassing `page.route`), so every check runs without one;
		// the worker itself is covered by `playwright.pwa.config.mjs`.
		serviceWorkers: 'block',
	},

	projects: variants.map((v) => ({
		name: `prod-build-${v.name}`,
		use: {
			...devices['Desktop Chrome'],
			viewport: v.viewport,
			colorScheme: v.colorScheme,
		},
	})),

	outputDir: 'test-results/prod-build/',

	// `vite preview` serves whatever `dist/` holds, so the build is part of the
	// command; otherwise a stale or absent bundle would be checked.
	webServer: {
		command: 'npm run build && npm run preview',
		port: 9100,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
})
