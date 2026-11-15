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
 * The fan app's bottom navigation: four tabs around the FAB's centre slot, and
 * the notch it cuts around the FAB. Runs on Chromium (`functional`) and WebKit
 * (`webkit-shell`). Which tab is highlighted, and the Settings item that ends
 * the FAB launcher on the tab pages, are checked against the real router in
 * test/app-shell.spec.ts and test/components/bottom-nav-bar.fixture.spec.ts.
 */

const NAV = 'components/infrastructure/fan/web/global/bottom-nav-bar'

const TAB_ICONS = ['home', 'discovery', 'my-artists', 'ticket']

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
	await settle(page, 'fab-menu')
}

/** Open Settings the way a fan does: the last item of the launcher. */
async function openSettingsFromLauncher(page: Page): Promise<void> {
	await openLauncher(page)
	await page.locator('fab-menu .fab-item[data-action-id="settings"]').click()
	await page.waitForURL('**/settings')
	await expect(page.locator('settings-route')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
	await seedSignedInFan(page)
})

test.describe('bottom navigation', () => {
	test(`@spec ${NAV} "Navigation shown on post-onboarding routes"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')

		await expect(tabs(page)).toHaveCount(4)
		const icons = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getAttribute('data-nav')),
		)
		expect(icons).toEqual(TAB_ICONS)
		await expect(page.locator('.nav-tab[data-nav="settings"]')).toHaveCount(0)

		// Two tabs on each side of an empty centre slot: the gap between the
		// second and third tab is wider than the FAB.
		const second = await box(tabs(page).nth(1))
		const third = await box(tabs(page).nth(2))
		expect(third.x - (second.x + second.width)).toBeGreaterThanOrEqual(56)
	})

	test(`@spec ${NAV} "Route with FAB actions"`, { tag: '@webkit' }, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await expect(fab(page)).toBeVisible()

		await expect(nav(page)).toHaveAttribute('data-notch', 'true')
		expect(await maskOf(page)).toContain('radial-gradient')
	})

	test(`@spec ${NAV} "Tickets shows the FAB"`, async ({ page }) => {
		await openShell(page, '/tickets')
		await expect(fab(page)).toBeVisible()
		await expect(nav(page)).toHaveAttribute('data-notch', 'true')
		expect(await maskOf(page)).toContain('radial-gradient')
	})

	test(`@spec ${NAV} "Route without FAB actions"`, { tag: '@webkit' }, async ({
		page,
	}) => {
		await openShell(page, '/settings')

		await expect(page.locator('fab-menu')).toHaveCount(0)
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
		await openShell(page, '/dashboard')
		await expect(fab(page)).toBeVisible()
		const onDashboard = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().x),
		)

		await openSettingsFromLauncher(page)
		await expect(page.locator('fab-menu')).toHaveCount(0)
		// Read the boxes at rest.
		await page.mouse.move(0, 0)
		await settle(page, 'bottom-nav-bar')
		const onSettings = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().x),
		)

		expect(onSettings).toEqual(onDashboard)
	})
})
