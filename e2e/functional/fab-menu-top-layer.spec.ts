import {
	box,
	centre,
	fab,
	nav,
	openShell,
	seedSignedInFan,
} from '../support/fan-shell'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * The FAB is a top-layer surface: above the Discovery dna orb canvas, and
 * absent wherever the navigation bar is hidden or no action is contributed.
 * Runs on Chromium (`functional`) and WebKit (`webkit-shell`).
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/fab-menu'

test(`@spec ${CAPABILITY} "FAB stays above the Discovery dna orb"`, async ({
	page,
}) => {
	await seedSignedInFan(page)
	await openShell(page, '/discovery')
	await expect(fab(page)).toBeVisible()
	await expect(page.locator('dna-orb-canvas canvas')).toBeAttached()

	expect(await fab(page).evaluate((el) => el.matches(':popover-open'))).toBe(
		true,
	)
	const c = centre(await box(fab(page)))
	const hit = await page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y)
		return el?.closest('.fab-toggle') !== null && el !== null
	}, c)
	expect(hit).toBe(true)
})

// @spec components/infrastructure/fan/web/global/fab-menu "Launcher absent on fullscreen routes"
test(`@spec ${CAPABILITY} "FAB hidden when navigation is hidden"`, async ({
	page,
}) => {
	// A guest: a signed-in fan is sent on from Welcome.
	await page.goto('/welcome')
	await page.locator('welcome-route').waitFor({ timeout: 30_000 })

	await expect(page.locator('bottom-nav-bar')).toHaveCount(0)
	await expect(page.locator('fab-menu')).toHaveCount(0)
})

test(`@spec ${CAPABILITY} "FAB hidden when no actions are contributed"`, async ({
	page,
}) => {
	await seedSignedInFan(page)
	await openShell(page, '/tickets')

	await expect(page.locator('fab-menu')).toHaveCount(0)
	await expect(nav(page)).toHaveAttribute('data-notch', 'false')
})
