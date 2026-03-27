import { expect, test } from '@playwright/test'

/**
 * Smoke tests that navigate to each public route and assert no console
 * errors are emitted during page load. Catches runtime template compilation
 * errors (AUR0703), unhandled exceptions, and startup failures.
 *
 * Network errors (failed fetch/XHR) are excluded since the backend may
 * not be running during tests.
 */

const EXCLUDED_ERROR_PATTERNS = [
	'net::ERR_',
	'Failed to fetch',
	'NetworkError',
	'ECONNREFUSED',
	'TypeError: Failed to fetch',
	'Failed to load resource',
	'[ERR Transport]',
]

function isExcludedError(text: string): boolean {
	return EXCLUDED_ERROR_PATTERNS.some((pattern) => text.includes(pattern))
}

const PUBLIC_ROUTES = ['/', '/welcome', '/about']

for (const route of PUBLIC_ROUTES) {
	test(`${route} loads without console errors`, async ({ page }) => {
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
