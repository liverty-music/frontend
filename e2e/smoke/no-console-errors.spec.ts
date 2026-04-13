import { expect, test } from '@playwright/test'

/**
 * Smoke tests that navigate to each public route and assert no console
 * errors are emitted during page load. Catches runtime template compilation
 * errors (AUR0703), unhandled exceptions, and startup failures.
 *
 * All RPC calls are intercepted and fulfilled with empty 200 responses so
 * the test is independent of dev environment availability. Network-level
 * errors (unreachable hosts, CORS) are also excluded since they indicate
 * infrastructure state rather than application correctness.
 */

const EXCLUDED_ERROR_PATTERNS = [
	'net::ERR_',
	'Failed to fetch',
	'NetworkError',
	'ECONNREFUSED',
	'TypeError: Failed to fetch',
	'Failed to load resource',
	'[ERR Transport]',
	'has been blocked by CORS policy',
	'Access-Control-Allow-Origin',
]

function isExcludedError(text: string): boolean {
	return EXCLUDED_ERROR_PATTERNS.some((pattern) => text.includes(pattern))
}

const PUBLIC_ROUTES = ['/', '/welcome', '/about']

for (const route of PUBLIC_ROUTES) {
	test(`${route} loads without console errors`, async ({ page }) => {
		// Intercept all RPC calls — smoke tests verify app startup correctness,
		// not backend availability. Returning empty 200s prevents CORS errors
		// from dev environment leaking into CI results.
		await page.route('**/liverty_music.rpc.**', (route) => {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		})

		const errors: string[] = []

		page.on('console', (msg) => {
			if (msg.type() === 'error' && !isExcludedError(msg.text())) {
				errors.push(msg.text())
			}
		})

		// Bypass auth/onboarding redirects
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
		})

		await page.goto(route)
		await page.waitForLoadState('networkidle')

		expect(errors, `Console errors on ${route}:\n${errors.join('\n')}`).toEqual(
			[],
		)
	})
}
