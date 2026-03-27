import { test as base, type Page } from '@playwright/test'

/**
 * Intercept all Connect-RPC requests and return minimal valid responses
 * so visual regression tests don't depend on a running backend.
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

const BYPASS_AUTH_SETUP = () => {
	localStorage.setItem('onboardingStep', 'completed')
}

const ONBOARDING_DISCOVER_SETUP = () => {
	localStorage.setItem('onboardingStep', 'discovery')
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
