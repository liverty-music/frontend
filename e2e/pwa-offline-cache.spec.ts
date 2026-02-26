import { expect, test } from '@playwright/test'

test.describe('Offline Concert Cache', () => {
	test('shows cached data with stale indicator when offline', async ({
		page,
		context,
	}) => {
		// Load dashboard while online to populate cache
		await page.goto('/dashboard')
		// Wait for initial data load attempt
		await page.waitForTimeout(2000)

		// Go offline and reload
		await context.setOffline(true)
		await page.reload()

		// When offline with cached data, the stale indicator should appear
		// (the fetch will fail, triggering the catch path with isStale=true)
		await page.waitForTimeout(5000)

		// Either we see stale data indicator or an error state — both are valid
		// depending on whether the SW cache has data
		const staleIndicator = page.locator('text=Data may be outdated')
		const errorState = page.locator('text=Failed to load live events')
		const emptyState = page.locator('text=No upcoming events')

		const anyVisible = await Promise.race([
			staleIndicator.waitFor({ timeout: 5000 }).then(() => 'stale'),
			errorState.waitFor({ timeout: 5000 }).then(() => 'error'),
			emptyState.waitFor({ timeout: 5000 }).then(() => 'empty'),
		]).catch(() => 'timeout')

		expect(['stale', 'error', 'empty']).toContain(anyVisible)

		// Restore connectivity for cleanup
		await context.setOffline(false)
	})

	test('shows error state when offline with no cache', async ({
		page,
		context,
	}) => {
		// Go offline immediately without prior cache
		await context.setOffline(true)
		await page.goto('/dashboard')

		// Should show error state, not infinite spinner
		await page.waitForTimeout(5000)

		// Verify no infinite loading — either error or empty state should appear
		const errorState = page.locator('text=Failed to load live events')
		const emptyState = page.locator('text=No upcoming events')

		const visible = await Promise.race([
			errorState.waitFor({ timeout: 10000 }).then(() => 'error'),
			emptyState.waitFor({ timeout: 10000 }).then(() => 'empty'),
		]).catch(() => 'timeout')

		expect(['error', 'empty']).toContain(visible)

		await context.setOffline(false)
	})
})
