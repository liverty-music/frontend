import { expect, type Page, test } from '../support/test'

/**
 * CI guard for the instant-page-switch change.
 *
 * Page identity (the shell page-header title + the active bottom-nav tab) is
 * driven optimistically from the router's navigation-start event, so it switches
 * at navigation intent — before the incoming route's content has loaded or
 * finished its entrance transition. This test forces that gap by delaying the
 * dashboard's ListByArtists response, taps the Home tab from Discovery, and
 * asserts the tab highlight and the header title have already switched while the
 * dashboard content is still in its loading state.
 *
 * Runs in the `functional` CI project (no auth — AuthHook gives guests free
 * roam); RPC is mocked so the assertion never needs a live backend.
 */

test.use({ viewport: { width: 390, height: 700 } })

async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', async (route) => {
		const url = route.request().url()
		if (url.includes('ListByArtists')) {
			// Hold the dashboard content back so the loading state persists long
			// enough to prove identity switched ahead of it.
			await new Promise((resolve) => setTimeout(resolve, 1500))
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ groups: [] }),
			})
		}
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		}),
	)
}

test.describe('Instant page switch (guest)', () => {
	test('tab highlight and header title switch before content settles', async ({
		page,
	}) => {
		await mockRpcRoutes(page)

		// Seed a guest with a home region + one follow so the dashboard renders
		// (unblurred, no home-selector) once its delayed data finally arrives.
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

		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('discovery-route', { timeout: 10_000 })

		const title = page.locator('page-header h1')
		const homeTab = page.locator('.nav-tab[data-nav="home"]')
		const discoveryTab = page.locator('.nav-tab[data-nav="discovery"]')

		// Baseline: on Discovery the Discovery tab is active and the header reads
		// "Discovery".
		await expect(discoveryTab).toHaveAttribute('data-active', 'true')
		await expect(title).toHaveText('Discovery')

		// Tap Home. Its data (ListByArtists) is held back 1.5s, so the dashboard
		// stays in its loading state.
		await homeTab.click()

		// Identity switches immediately: Home tab active + header title "Timetable",
		// while the dashboard content is still loading (skeleton shown, no concert
		// cards yet). This is the whole point — identity leads content.
		await expect(homeTab).toHaveAttribute('data-active', 'true')
		await expect(discoveryTab).toHaveAttribute('data-active', 'false')
		await expect(title).toHaveText('Timetable')
		// The placeholder is now one element per skeleton date row, so scope to the
		// first: it is the timetable's own structure standing in for the concerts,
		// not a single generic bar stack.
		await expect(
			page.locator('[data-testid="dashboard-loading"]').first(),
		).toBeVisible()

		// And once the delayed data resolves, the loading state clears — the content
		// caught up to the identity that already switched.
		await expect(
			page.locator('[data-testid="dashboard-loading"]').first(),
		).toBeHidden({ timeout: 10_000 })
	})
})
