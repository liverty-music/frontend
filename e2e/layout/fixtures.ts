import { test as base, type Page } from '@playwright/test'

/**
 * Intercept all Connect-RPC requests to the backend API and return
 * minimal valid responses so layout tests don't depend on a running backend.
 *
 * Connect-RPC uses POST with JSON body to paths like:
 *   /liverty_music.rpc.artist.v1.ArtistService/ListTop
 */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/**
 * Set localStorage values so routes render without auth/onboarding redirects.
 * Step 7 = COMPLETED: bypasses tutorial restrictions for non-tutorial routes.
 */
const BYPASS_AUTH_SETUP = () => {
	localStorage.setItem('onboardingStep', '7')
}

/**
 * Set onboarding step to DISCOVER (1) so the auth hook allows
 * tutorial routes (discover, loading, dashboard) without authentication.
 */
const ONBOARDING_DISCOVER_SETUP = () => {
	localStorage.setItem('onboardingStep', '1')
}

export const test = base.extend<{
	layoutPage: Page
	discoverLayoutPage: Page
}>({
	layoutPage: async ({ page }, use) => {
		await page.addInitScript(BYPASS_AUTH_SETUP)
		await mockRpcRoutes(page)
		await use(page)
	},
	discoverLayoutPage: async ({ page }, use) => {
		await page.addInitScript(ONBOARDING_DISCOVER_SETUP)
		await mockRpcRoutes(page)
		await use(page)
	},
})

export { expect } from '@playwright/test'
