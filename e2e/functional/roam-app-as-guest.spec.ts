import { mockFanRpc } from '../support/fan-auth'
import { openShell, seedSignedInFan } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })

/**
 * The auth hook gates routes on sign-in only: a guest roams every screen at
 * their addresses, and the timetable guides a guest with no follows toward
 * Discovery instead of redirecting. The backend is mocked.
 */

const STORY = 'stories/roam-app-as-guest'

/** A guest past onboarding with no follows. */
async function seedGuest(page: Page): Promise<void> {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('language', 'ja')
	})
	await mockFanRpc(page)
}

/** Open `path` and wait for `route` to be displayed at that same address. */
async function expectServedAt(
	page: Page,
	path: string,
	route: string,
): Promise<void> {
	await page.goto(path)
	await expect(page.locator(route)).toBeVisible({ timeout: 30_000 })
	expect(new URL(page.url()).pathname).toBe(path)
}

test(`@spec ${STORY} "Authenticated user navigates to any route"`, async ({
	page,
}) => {
	await seedSignedInFan(page, { language: 'ja' })
	await openShell(page, '/timetable')
	await expectServedAt(page, '/tickets', 'tickets-route')
	await expectServedAt(page, '/settings', 'settings-route')
	await expectServedAt(page, '/my-artists', 'my-artists-route')
})

test(`@spec ${STORY} "Public route is always allowed"`, async ({ page }) => {
	await seedGuest(page)
	await expectServedAt(page, '/about', 'about-route')
	await expectServedAt(page, '/legal/terms', 'terms-route')
	await expectServedAt(page, '/sign-in-help', 'sign-in-help-route')
})

test(`@spec ${STORY} "Guest navigates to an application route"`, async ({
	page,
}) => {
	await seedGuest(page)
	await openShell(page, '/discovery')
	await expectServedAt(page, '/my-artists', 'my-artists-route')
	await expectServedAt(page, '/tickets', 'tickets-route')
	await expectServedAt(page, '/settings', 'settings-route')
	// Account-only controls are replaced at point of use, not by a redirect.
	await expect(page.getByTestId('settings-sign-in')).toBeVisible()
})

test(`@spec ${STORY} "Guest with no follows lands on the timetable"`, async ({
	page,
}) => {
	await seedGuest(page)
	await openShell(page, '/timetable')
	await expect(page.locator('timetable-route')).toBeVisible()
	await expect(page.getByTestId('discover-link')).toBeVisible({
		timeout: 30_000,
	})
	expect(new URL(page.url()).pathname).toBe('/timetable')
})
