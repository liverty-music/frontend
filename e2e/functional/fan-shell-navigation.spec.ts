import {
	box,
	fab,
	nav,
	openShell,
	seedSignedInFan,
	settle,
	tabs,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * The fan app's bottom navigation on both engines: the notch it cuts around
 * the FAB, and the tabs that stay put when a real navigation hides the FAB.
 * Runs on Chromium (`functional`) and WebKit (`webkit-shell`). The tabs and
 * the centre slot are checked in the app shell's stories
 * (src/app-shell.stories.ts); which tab is highlighted, and the Settings item
 * that ends the FAB launcher on the tab pages, against the real router in
 * test/app-shell.spec.ts and test/components/bottom-nav-bar.fixture.spec.ts.
 */

const NAV = 'components/infrastructure/fan/web/global/bottom-nav-bar'

/** The bar's computed mask image (WebKit may only expose the prefixed one). */
const maskOf = (page: Page) =>
	nav(page).evaluate((el) => {
		const style = getComputedStyle(el) as CSSStyleDeclaration & {
			webkitMaskImage?: string
		}
		const mask = style.maskImage || style.webkitMaskImage || 'none'
		return mask
	})

/** Open the launcher and wait until its items are laid out. */
async function openLauncher(page: Page): Promise<void> {
	await fab(page).click()
	await expect(fab(page)).toHaveAttribute('aria-expanded', 'true')
	await settle(page, 'action-menu')
}

/** Open Settings the way a fan does: the last item of the launcher. */
async function openSettingsFromLauncher(page: Page): Promise<void> {
	await openLauncher(page)
	await page.locator('action-menu .fab-item[data-action-id="settings"]').click()
	await page.waitForURL('**/settings')
	await expect(page.locator('settings-route')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
	await seedSignedInFan(page)
})

test.describe('bottom navigation', () => {
	test(`@spec ${NAV} "Route with action menu actions"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/timetable')
		await expect(fab(page)).toBeVisible()

		await expect(nav(page)).toHaveAttribute('data-notch', 'true')
		expect(await maskOf(page)).toContain('radial-gradient')
	})

	test(`@spec ${NAV} "Route without action menu actions"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/settings')

		await expect(page.locator('action-menu')).toHaveCount(0)
		await expect(nav(page)).toHaveAttribute('data-notch', 'false')
		expect(await maskOf(page)).toBe('none')
		// The centre slot stays, empty.
		const second = await box(tabs(page).nth(1))
		const third = await box(tabs(page).nth(2))
		expect(third.x - (second.x + second.width)).toBeGreaterThanOrEqual(56)
	})

	test(`@spec ${NAV} "Tabs do not move between routes"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openShell(page, '/timetable')
		await expect(fab(page)).toBeVisible()
		const onTimetable = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().x),
		)

		await openSettingsFromLauncher(page)
		await expect(page.locator('action-menu')).toHaveCount(0)
		// Read the boxes at rest.
		await page.mouse.move(0, 0)
		await settle(page, 'bottom-nav-bar')
		const onSettings = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().x),
		)

		expect(onSettings).toEqual(onTimetable)
	})
})
