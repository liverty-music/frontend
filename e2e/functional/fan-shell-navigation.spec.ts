import {
	box,
	fab,
	nav,
	openShell,
	seedSignedInFan,
	settle,
	tabs,
	tapTab,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * The fan app's bottom navigation (four tabs around the FAB's centre slot) and
 * the Settings entry in the page header. Runs on Chromium (`functional`) and
 * WebKit (`webkit-shell`).
 */

const NAV = 'components/infrastructure/fan/web/global/bottom-nav-bar'
const HEADER = 'components/infrastructure/fan/web/global/page-header'
const SETTINGS = 'components/infrastructure/fan/web/route/settings'

const TAB_ICONS = ['home', 'discovery', 'my-artists', 'ticket']
const TAB_PATHS: Record<string, string> = {
	home: '/dashboard',
	discovery: '/discovery',
	'my-artists': '/my-artists',
	ticket: '/tickets',
}

/** The bar's computed mask image (WebKit may only expose the prefixed one). */
const maskOf = (page: Page) =>
	nav(page).evaluate((el) => {
		const style = getComputedStyle(el) as CSSStyleDeclaration & {
			webkitMaskImage?: string
		}
		const mask = style.maskImage || style.webkitMaskImage || 'none'
		return mask
	})

const gear = (page: Page) => page.getByTestId('page-header-settings')

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

	test(`@spec ${NAV} "Route with FAB actions"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		await expect(fab(page)).toBeVisible()

		await expect(nav(page)).toHaveAttribute('data-notch', 'true')
		expect(await maskOf(page)).toContain('radial-gradient')
	})

	test(`@spec ${NAV} "Route without FAB actions"`, async ({ page }) => {
		await openShell(page, '/tickets')

		await expect(page.locator('fab-menu')).toHaveCount(0)
		await expect(nav(page)).toHaveAttribute('data-notch', 'false')
		expect(await maskOf(page)).toBe('none')
		// The centre slot stays, empty.
		const second = await box(tabs(page).nth(1))
		const third = await box(tabs(page).nth(2))
		expect(third.x - (second.x + second.width)).toBeGreaterThanOrEqual(56)
	})

	test(`@spec ${NAV} "Tabs do not move between routes"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		await expect(fab(page)).toBeVisible()
		const onDashboard = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().x),
		)

		await tapTab(page, 'ticket')
		await page.waitForURL('**/tickets')
		await expect(page.locator('fab-menu')).toHaveCount(0)
		// Read the boxes at rest, after the tapped tab's press scale.
		await page.mouse.move(0, 0)
		await settle(page, 'bottom-nav-bar')
		const onTickets = await tabs(page).evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().x),
		)

		expect(onTickets).toEqual(onDashboard)
	})

	test(`@spec ${NAV} "Tab route displayed"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		for (const icon of TAB_ICONS) {
			await tapTab(page, icon)
			await page.waitForURL(`**${TAB_PATHS[icon]}`)
			const active = page.locator('.nav-tab[data-active="true"]')
			await expect(active).toHaveCount(1)
			await expect(active).toHaveAttribute('data-nav', icon)
		}
	})

	test(`@spec ${NAV} "Route outside every tab"`, async ({ page }) => {
		for (const path of [
			'/settings',
			'/orders/00000000-0000-4000-8000-0d0000000001',
		]) {
			await openShell(page, path)
			await expect(page.locator('.nav-tab[data-active="true"]')).toHaveCount(0)
		}
	})
})

test.describe('Settings entry in the page header', () => {
	test(`@spec ${HEADER} "Gear on a tab page"`, async ({ page }) => {
		await openShell(page, '/dashboard')
		for (const icon of TAB_ICONS) {
			await tapTab(page, icon)
			await page.waitForURL(`**${TAB_PATHS[icon]}`)
			await expect(
				page.locator('page-header').getByRole('link', { name: 'Settings' }),
			).toBeVisible()
			// At the header's trailing end.
			const header = await box(page.locator('page-header header'))
			const g = await box(gear(page))
			expect(header.x + header.width - (g.x + g.width)).toBeLessThan(24)
		}

		await gear(page).click()
		await page.waitForURL('**/settings')
		await expect(page.locator('settings-route')).toBeVisible()
	})

	test(`@spec ${HEADER} "No gear on Settings"`, async ({ page }) => {
		await openShell(page, '/settings')
		await expect(page.locator('page-header h1')).toHaveText('Settings')
		await expect(gear(page)).toHaveCount(0)
	})

	test(`@spec ${HEADER} "No gear outside the tabs"`, async ({ page }) => {
		// An order detail shows a header of its own, without the gear.
		await openShell(page, '/orders/00000000-0000-4000-8000-0d0000000001')
		await expect(page.locator('page-header h1')).toBeVisible()
		await expect(gear(page)).toHaveCount(0)

		// The Event page shows no shell header at all.
		await openShell(page, '/events/00000000-0000-4000-8000-0e0000000001')
		await expect(gear(page)).toHaveCount(0)
	})
})

test.describe('Settings header in Japanese', () => {
	test.use({ locale: 'ja-JP' })

	// biome-ignore lint/suspicious/noUselessEscapeInString: scripts/check-scenario-coverage.py reads \" as a quote inside the scenario name
	test(`@spec ${SETTINGS} "Header reads \"Settings\" regardless of active locale"`, async ({
		page,
	}) => {
		await seedSignedInFan(page, { language: 'ja' })
		await openShell(page, '/settings')
		await expect(page.locator('html')).toHaveAttribute('lang', 'ja')

		await expect(page.locator('page-header h1')).toHaveText('Settings')
		await expect(page.locator('page-header h1')).not.toHaveText('設定')
	})
})
