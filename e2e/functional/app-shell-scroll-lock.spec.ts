import { expect, type Page, test } from '@playwright/test'

/**
 * CI layout-regression guard for the fix-pwa-app-shell-scroll-lock change.
 *
 * The original bug: in the installed (standalone) PWA, a pull-to-refresh /
 * overscroll gesture scrolled the whole document. `reset.css` set
 * `body { min-block-size: 100dvh }` with no root `overflow`/`overscroll-behavior`,
 * so any transient where the dynamic viewport resolved larger than the visible
 * area left `body` with a few pixels of scroll range. The document became a
 * scroll source: the bottom nav dropped off-screen, and scrolling to the bottom
 * pushed the header ("Timetable" title row) off the top — nav and header became
 * mutually exclusive on screen.
 *
 * The fix makes the document root a non-scrolling frame
 * (`html, body { block-size: 100%; overflow: hidden; overscroll-behavior: none }`,
 * `body { min-block-size: 100dvh }` removed) and confines scrolling to the single
 * inner `.concert-scroll` container (`overscroll-behavior: contain`). The
 * `app-shell` 100dvh grid stays the height owner.
 *
 * Playwright cannot fire a real native pull-to-refresh gesture, so this guard
 * asserts the CSS mechanism that neutralizes it: the root elements are locked
 * (computed `overflow: hidden` + `overscroll-behavior: none`), the document does
 * not scroll even when scripted to, and the shell chrome (bottom nav + header)
 * stays pinned. Runs in the `functional` CI project (no auth — AuthHook gives
 * guests free roam); RPC is mocked so the assertion never needs a live backend.
 */

// A short viewport so the concert list overflows and the inner scroll container
// is actually engaged — the regressed layout only shifted once `body` had room
// to scroll.
test.use({ viewport: { width: 390, height: 600 } })

/** A ConcertService/ListWithProximity payload with many concerts across several
 *  dates, so the inner `.concert-scroll` list overflows the short viewport. */
function proximityPayload() {
	const base = new Date()
	const groups = Array.from({ length: 8 }, (_, dayOffset) => {
		const date = new Date(base)
		date.setDate(base.getDate() + dayOffset + 1)
		const localDate = {
			value: {
				year: date.getFullYear(),
				month: date.getMonth() + 1,
				day: date.getDate(),
			},
		}
		const home = Array.from({ length: 3 }, (_, i) => ({
			id: { value: `c-${dayOffset}-${i}` },
			performers: [
				{
					id: { value: 'artist-1' },
					name: { value: 'YOASOBI' },
					mbid: { value: '' },
				},
			],
			series: {
				id: { value: `s-${dayOffset}-${i}` },
				title: { value: 'Zepp DiverCity Live' },
			},
			localDate,
			venue: {
				name: { value: 'Zepp DiverCity' },
				adminArea: { value: 'JP-13' },
			},
			sourceUrl: { value: 'https://example.com' },
		}))
		return { date: localDate, home, nearby: [], away: [] }
	})
	return { groups }
}

async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		if (url.includes('ListWithProximity')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(proximityPayload()),
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

test.describe('App shell scroll lock (guest)', () => {
	test('document root is a non-scrolling frame and shell chrome stays pinned', async ({
		page,
	}) => {
		await mockRpcRoutes(page)

		// Seed a guest with a home region so the dashboard renders unblurred and
		// the home selector does not open over the layout under test.
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
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

		await page.goto('http://localhost:9000/dashboard')
		await page.waitForSelector('concert-highway', { timeout: 10_000 })
		await page.waitForSelector('[data-testid="concert-scroll"]', {
			timeout: 10_000,
		})

		// 1) The document root is locked: overflow hidden + overscroll-behavior none
		//    on both html and body. This is the mechanism that neutralizes the
		//    native pull-to-refresh gesture.
		const rootStyles = await page.evaluate(() => {
			const read = (el: Element) => {
				const s = getComputedStyle(el)
				return { overflowY: s.overflowY, overscroll: s.overscrollBehaviorY }
			}
			return {
				html: read(document.documentElement),
				body: read(document.body),
			}
		})
		expect(rootStyles.html.overflowY).toBe('hidden')
		expect(rootStyles.body.overflowY).toBe('hidden')
		expect(rootStyles.html.overscroll).toBe('none')
		expect(rootStyles.body.overscroll).toBe('none')

		// 2) The inner scroll container contains its overscroll.
		const innerOverscroll = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="concert-scroll"]')
			return el ? getComputedStyle(el).overscrollBehaviorY : null
		})
		expect(innerOverscroll).toBe('contain')

		// Capture shell chrome positions before attempting to scroll the document.
		const header = page.locator('page-header header').first()
		const nav = page.locator('bottom-nav-bar').first()
		await expect(header).toBeVisible()
		await expect(nav).toBeVisible()
		const headerBefore = await header.boundingBox()
		const navBefore = await nav.boundingBox()
		expect(headerBefore).not.toBeNull()
		expect(navBefore).not.toBeNull()
		if (!headerBefore || !navBefore) return

		// 3) The document does not scroll even when scripted to — the shell can
		//    never shift the way the overscroll gesture used to shift it.
		const scrollTop = await page.evaluate(() => {
			window.scrollTo(0, 1000)
			return document.scrollingElement?.scrollTop ?? window.scrollY
		})
		expect(scrollTop).toBe(0)

		// 4) Header stays pinned at the top and the nav stays pinned at the
		//    bottom — they remain simultaneously visible, never mutually exclusive.
		const headerAfter = await header.boundingBox()
		const navAfter = await nav.boundingBox()
		expect(headerAfter).not.toBeNull()
		expect(navAfter).not.toBeNull()
		if (!headerAfter || !navAfter) return

		expect(headerAfter.y).toBeCloseTo(headerBefore.y, 0)
		expect(navAfter.y).toBeCloseTo(navBefore.y, 0)
		// Header pinned at the top edge; nav pinned at the bottom edge.
		const viewport = page.viewportSize()
		expect(headerAfter.y).toBeLessThanOrEqual(1)
		if (viewport) {
			expect(navAfter.y + navAfter.height).toBeGreaterThanOrEqual(
				viewport.height - 1,
			)
		}
	})
})
