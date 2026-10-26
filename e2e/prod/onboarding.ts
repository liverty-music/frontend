import type { Page } from '@playwright/test'

/**
 * Opt the browser out of analytics before the app boots, so a run against
 * production sends no usage events. Intercepting the requests instead would
 * also catch the service worker's update check and break the app's boot.
 */
export async function optOutOfAnalytics(page: Page): Promise<void> {
	await page.addInitScript(() => {
		localStorage.setItem(
			'consent.state',
			JSON.stringify({ version: 2, analytics: false, sessionReplay: false }),
		)
	})
}
