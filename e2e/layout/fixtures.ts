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
 */
const BYPASS_AUTH_SETUP = () => {
	// Set step to COMPLETED (7) so isOnboarding=false and bottom-nav is visible
	localStorage.setItem('onboardingStep', '7')
}

export const test = base.extend<{ layoutPage: Page }>({
	layoutPage: async ({ page }, use) => {
		await page.addInitScript(BYPASS_AUTH_SETUP)
		await mockRpcRoutes(page)
		await use(page)
	},
})

export { expect } from '@playwright/test'
