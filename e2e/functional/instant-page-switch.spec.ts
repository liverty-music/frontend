import { expect, type Page, test } from '../support/test'

/**
 * Page identity (the shell page-header title + the active bottom-nav tab)
 * matches the route that is displayed. Both are read from the displayed route's
 * configuration through the router, so they change when a navigation completes
 * and never show a navigation that did not complete.
 *
 * Runs in the `functional` CI project (no auth — AuthHook gives guests free
 * roam); RPC is mocked so the assertions never need a live backend.
 */

test.use({ viewport: { width: 390, height: 700 } })

async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		}),
	)
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		}),
	)
}

/**
 * Give the My Artists route a `canLoad` guard that refuses while
 * `window.__blockMyArtists` is true. No product route refuses a guest, so the
 * guard is appended to the route module the dev server serves; the rest of the
 * app is untouched.
 */
async function guardMyArtists(page: Page): Promise<void> {
	await page.route('**/src/routes/my-artists/my-artists-route.ts*', async (route) => {
		const response = await route.fetch()
		const body = `${await response.text()}
MyArtistsRoute.prototype.canLoad = function () {
	return window.__blockMyArtists !== true
}
`
		await route.fulfill({ response, body })
	})
}

async function seedGuest(page: Page): Promise<void> {
	// A guest with a home region + one follow, so the dashboard renders without
	// the home selector.
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{
					artist: { id: 'artist-1', name: 'YOASOBI', mbid: 'mbid-1' },
					home: 'JP-13',
				},
			]),
		)
	})
}

const title = (page: Page) => page.locator('page-header h1')
const tab = (page: Page, icon: string) =>
	page.locator(`.nav-tab[data-nav="${icon}"]`)
const activeTabs = (page: Page) => page.locator('.nav-tab[data-active="true"]')

test.describe('Page identity follows the displayed route (guest)', () => {
	test.beforeEach(async ({ page }) => {
		await mockRpcRoutes(page)
		await seedGuest(page)
	})

	// @spec components/infrastructure/fan/web/global/page-header "Header title and active tab match the route shown"
	test('a tab switch shows the target route’s title and tab', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('discovery-route', { timeout: 10_000 })

		await expect(tab(page, 'discovery')).toHaveAttribute('data-active', 'true')
		await expect(title(page)).toHaveText('Discovery')

		await tab(page, 'home').click()
		await page.waitForSelector('dashboard-route', { timeout: 10_000 })

		await expect(tab(page, 'home')).toHaveAttribute('data-active', 'true')
		await expect(activeTabs(page)).toHaveCount(1)
		await expect(title(page)).toHaveText('Timetable')
	})

	// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Concert deep-link highlights Home"
	test('a concert deep-link highlights Home', async ({ page }) => {
		await page.goto('http://localhost:9000/concerts/concert-1')
		await page.waitForSelector('dashboard-route', { timeout: 10_000 })

		await expect(tab(page, 'home')).toHaveAttribute('data-active', 'true')
		await expect(activeTabs(page)).toHaveCount(1)
		await expect(title(page)).toHaveText('Timetable')
	})

	// @spec components/infrastructure/fan/web/global/page-header "A failed navigation leaves identity unchanged"
	test('a navigation blocked by a guard leaves the previous title and tab', async ({
		page,
	}) => {
		await guardMyArtists(page)
		await page.goto('http://localhost:9000/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })
		await expect(title(page)).toHaveText('Settings')

		// Record every change to the header and the nav bar from here on, then
		// tap a tab whose route refuses to load.
		await page.evaluate(() => {
			const w = window as unknown as {
				__blockMyArtists: boolean
				__identityWrites: string[]
			}
			w.__blockMyArtists = true
			w.__identityWrites = []
			const inIdentity = (n: Node | null) =>
				n instanceof Element &&
				n.closest('page-header, bottom-nav-bar') != null
			new MutationObserver((records) => {
				for (const r of records) {
					if (
						r.type === 'attributes' ||
						inIdentity(r.target) ||
						inIdentity(r.target.parentElement) ||
						[...r.addedNodes, ...r.removedNodes].some(
							(n) => n instanceof Element && n.matches('page-header, bottom-nav-bar'),
						)
					) {
						w.__identityWrites.push(r.type)
					}
				}
			}).observe(document.body, {
				subtree: true,
				childList: true,
				characterData: true,
				attributes: true,
				attributeFilter: ['data-active'],
			})
		})
		await tab(page, 'my-artists').click()
		// Let the refused navigation run its course.
		await page.waitForTimeout(500)

		await expect(page.locator('settings-route')).toBeVisible()
		await expect(page.locator('my-artists-route')).toHaveCount(0)
		await expect(title(page)).toHaveText('Settings')
		await expect(tab(page, 'settings')).toHaveAttribute('data-active', 'true')
		await expect(activeTabs(page)).toHaveCount(1)
		// At no point did the header or the tab highlight change.
		expect(
			await page.evaluate(
				() => (window as unknown as { __identityWrites: string[] }).__identityWrites,
			),
		).toEqual([])

		// Control: once the guard allows it, the same tap switches identity.
		await page.evaluate(() => {
			;(window as unknown as { __blockMyArtists: boolean }).__blockMyArtists =
				false
		})
		await tab(page, 'my-artists').click()
		await page.waitForSelector('my-artists-route', { timeout: 10_000 })
		await expect(title(page)).toHaveText('My Artists')
		await expect(tab(page, 'my-artists')).toHaveAttribute('data-active', 'true')
	})
})
