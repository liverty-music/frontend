import { box, centre, openShell, seedSignedInFan } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
// The smallest phone the app supports: the empty state reaches the banner here.
test.use({ viewport: { width: 320, height: 568 } })

/**
 * The route area ends above a visible bottom banner (frontend#787): the shell
 * shortens `<au-viewport>` by the banner's published height, so a route's last
 * row and its empty state lie above the banner and take taps there.
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/app-shell'

/** Whether a tap at the centre of `selector` reaches that element. */
async function tapReaches(page: Page, selector: string): Promise<boolean> {
	const c = centre(await box(page.locator(selector)))
	return page.evaluate(
		({ x, y, selector }) =>
			document.elementFromPoint(x, y)?.closest(selector) != null,
		{ ...c, selector },
	)
}

/** The bottom edge of the area routes render in (the viewport's content box). */
async function routeAreaBottom(page: Page): Promise<number> {
	return page.locator('au-viewport').evaluate((el) => {
		const rect = el.getBoundingClientRect()
		return rect.bottom - Number.parseFloat(getComputedStyle(el).paddingBottom)
	})
}

test(`@spec ${CAPABILITY} "Last row clears the banner"`, async ({ page }) => {
	await seedSignedInFan(page, { installBanner: true })
	await openShell(page, '/settings')
	const banner = page.locator('.pwa-banner')
	await expect(banner).toBeVisible()
	const signOut = page.locator('.settings-sign-out')
	await expect(signOut).toBeVisible()

	await page
		.getByTestId('settings-scroll')
		.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))

	const bannerTop = (await box(banner)).y
	const row = await box(signOut)
	expect(row.y + row.height).toBeLessThanOrEqual(bannerTop + 0.5)
	expect(await routeAreaBottom(page)).toBeCloseTo(bannerTop, 0)
	expect(await tapReaches(page, '.settings-sign-out')).toBe(true)
})

test(`@spec ${CAPABILITY} "Empty state clears the banner and the FAB"`, async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('onboarding.helpSeen:my-artists', '1')
		localStorage.setItem('ui.notificationPromptDismissed', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('guest.followedArtists', '[]')
	})
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await openShell(page, '/my-artists')
	const banner = page.locator('.signup-banner')
	await expect(banner).toBeVisible()
	const button = page.getByTestId('discover-link')
	await expect(button).toBeVisible()

	const b = await box(button)
	expect(b.y + b.height).toBeLessThanOrEqual((await box(banner)).y + 0.5)
	expect(await tapReaches(page, '[data-testid="discover-link"]')).toBe(true)
})

test(`@spec ${CAPABILITY} "No banner, no reserved space"`, async ({ page }) => {
	await seedSignedInFan(page)
	await openShell(page, '/settings')
	await expect(page.locator('settings-route')).toBeVisible()
	await expect(page.locator('.pwa-banner, .signup-banner')).toHaveCount(0)

	const navTop = (await box(page.locator('bottom-nav-bar nav'))).y
	expect(await routeAreaBottom(page)).toBeCloseTo(navTop, 0)
	const viewport = await box(page.locator('au-viewport'))
	expect(viewport.y + viewport.height).toBeCloseTo(navTop, 0)
})
