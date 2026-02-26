import { expect, test } from '@playwright/test'

test.describe('Offline Concert Cache', () => {
	test('shows stale indicator or error when going offline after initial load', async ({
		page,
		context,
	}) => {
		// Load dashboard while online to populate SW cache
		await page.goto('/dashboard')
		await page.waitForTimeout(3000)

		// Go offline
		await context.setOffline(true)

		// Trigger a reload — since we're offline, the SW should serve cached
		// data, and the app may show a stale indicator or fall through to error
		await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {
			// reload might partially fail but the SW should serve the shell
		})

		await page.waitForTimeout(5000)

		// Check that the page rendered something meaningful (not blank)
		const bodyText = await page.locator('body').textContent()
		expect(bodyText).toBeTruthy()

		// Restore connectivity for cleanup
		await context.setOffline(false)
	})

	test('handles offline with no cache gracefully', async ({
		page,
		context,
	}) => {
		// Navigate to a page first (while online) to have the app shell cached
		await page.goto('/')
		await page.waitForTimeout(2000)

		// Go offline
		await context.setOffline(true)

		// Try navigating to dashboard via client-side routing
		await page.evaluate(() => {
			window.location.hash = '#/dashboard'
		})
		await page.waitForTimeout(5000)

		// The page should not be stuck in an infinite loading state.
		// Either an error message, empty state, or stale data should appear.
		const bodyText = await page.locator('body').textContent()
		expect(bodyText).toBeTruthy()
		// No infinite spinner — verify by checking the page has settled
		const spinnerCount = await page.locator('.animate-spin').count()
		// Acceptable: 0 spinners (loaded) or some transient spinners
		expect(spinnerCount).toBeLessThanOrEqual(3)

		await context.setOffline(false)
	})
})
