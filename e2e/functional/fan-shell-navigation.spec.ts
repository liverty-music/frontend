import {
	box,
	fab,
	fabItems,
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
 * the Settings item that ends the FAB launcher on the tab pages. Runs on
 * Chromium (`functional`) and WebKit (`webkit-shell`).
 */

const NAV = 'components/infrastructure/fan/web/global/bottom-nav-bar'
const FAB = 'components/infrastructure/fan/web/global/fab-menu'
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

const itemIds = (page: Page) =>
	fabItems(page).evaluateAll((els) =>
		els.map((el) => el.getAttribute('data-action-id')),
	)

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

	test(`@spec ${NAV} "Route with FAB actions"`, async ({ page }) => {
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

	test(`@spec ${NAV} "Route without FAB actions"`, async ({ page }) => {
		await openShell(page, '/settings')

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

test.describe('Settings item in the launcher', () => {
	test(`@spec ${FAB} "Settings is the last item on the dashboard"`, async ({
		page,
	}) => {
		await openShell(page, '/dashboard')
		await openLauncher(page)
		// From the FAB outward.
		expect(await itemIds(page)).toEqual(['beam', 'filter', 'help', 'settings'])
		await expect(
			page.locator('fab-menu .fab-item[data-action-id="settings"]'),
		).toHaveText(/Settings/)
	})

	test(`@spec ${FAB} "Settings is the only item on Tickets"`, async ({
		page,
	}) => {
		await openShell(page, '/tickets')
		await expect(fab(page)).toBeVisible()
		await openLauncher(page)
		expect(await itemIds(page)).toEqual(['settings'])
	})

	test(`@spec ${FAB} "Choosing Settings"`, async ({ page }) => {
		for (const icon of TAB_ICONS) {
			await openShell(page, TAB_PATHS[icon])
			await openSettingsFromLauncher(page)
			// The launcher closed; Settings offers none.
			await expect(page.locator('fab-menu')).toHaveCount(0)
		}
		// No tab page shows a Settings gear in the header any more.
		await expect(page.locator('page-header a')).toHaveCount(0)
	})

	test(`@spec ${FAB} "No Settings item outside the tabs"`, async ({ page }) => {
		for (const path of [
			'/settings',
			'/events/00000000-0000-4000-8000-0e0000000001',
			'/orders/00000000-0000-4000-8000-0d0000000001',
		]) {
			await openShell(page, path)
			await expect(
				page.locator('fab-menu .fab-item[data-action-id="settings"]'),
			).toHaveCount(0)
		}
	})

	test(`@spec ${FAB} "FAB hidden when no actions are contributed"`, async ({
		page,
	}) => {
		await openShell(page, '/settings')
		await expect(page.locator('fab-menu')).toHaveCount(0)
		await expect(nav(page)).toHaveAttribute('data-notch', 'false')
	})

	test(`@spec ${FAB} "FAB hidden while the route hides the launcher"`, async ({
		page,
	}) => {
		await page.route(
			(url) => url.pathname.includes('FollowService/List'),
			(route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						artists: [
							{
								artist: {
									id: { value: '00000000-0000-4000-8000-a10000000001' },
									name: { value: 'YOASOBI' },
								},
								hype: 1,
							},
						],
					}),
				}),
		)
		await page.context().addInitScript(() => {
			localStorage.setItem('onboarding.helpSeen:my-artists', '1')
		})
		await openShell(page, '/my-artists')
		await expect(page.locator('.artist-row').first()).toBeVisible()
		await openLauncher(page)
		expect(await itemIds(page)).toEqual(['edit', 'help', 'settings'])

		await page.locator('fab-menu .fab-item[data-action-id="edit"]').click()
		await expect(page.locator('.artist-remove-btn').first()).toBeVisible()
		await expect(page.locator('fab-menu')).toHaveCount(0)

		await page.getByRole('button', { name: 'Done' }).click()
		await expect(fab(page)).toBeVisible()
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
