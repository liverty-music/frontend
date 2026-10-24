import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

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

/** A ConcertService/ListByArtists payload with many concerts across several
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
			id: { value: fakeId(`c-${dayOffset}-${i}`) },
			performers: [
				{
					id: { value: '00000000-0000-4000-8000-a00000000001' },
					name: { value: 'YOASOBI' },
					mbid: { value: '' },
				},
			],
			series: {
				id: { value: fakeId(`s-${dayOffset}-${i}`) },
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
		if (url.includes('ListByArtists')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(concertWire(proximityPayload())),
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

const APP_SHELL = 'components/infrastructure/fan/web/global/app-shell'

/** A guest dashboard with the overflowing timetable from `proximityPayload`. */
async function openDashboard(page: Page): Promise<void> {
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
					artist: {
						id: '00000000-0000-4000-8000-a00000000001',
						name: 'YOASOBI',
						mbid: '00000000-0000-4000-8000-b00000000001',
					},
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
	await expect(
		page.locator('[data-testid="concert-scroll"] [data-live-card]').first(),
	).toBeVisible({ timeout: 10_000 })
}

test.describe('App shell scroll lock (guest)', () => {
	test(`@spec ${APP_SHELL} "Bottom nav and header stay pinned after a pull-to-refresh gesture"`, async ({
		page,
	}) => {
		await openDashboard(page)

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

	// The 8 dates × 3 concerts of `proximityPayload` overflow the 600px viewport.
	test(`@spec ${APP_SHELL} "Bottom nav stays at viewport bottom"`, async ({
		page,
	}) => {
		await openDashboard(page)
		const viewport = page.viewportSize()
		expect(viewport).not.toBeNull()
		if (!viewport) return
		const nav = page.locator('bottom-nav-bar').first()

		const navIsPinned = async () => {
			await expect(nav).toBeVisible()
			const box = await nav.boundingBox()
			expect(box).not.toBeNull()
			if (!box) return
			expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 1)
			expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
		}

		await navIsPinned()

		// The route is held to the viewport's height: it fills the routing
		// viewport and no element between the viewport and the scroll container
		// is taller than the viewport, however long the list is.
		const chain = await page.evaluate(() => {
			const viewportEl = document.querySelector('au-viewport') as HTMLElement
			const scroll = document.querySelector(
				'[data-testid="concert-scroll"]',
			) as HTMLElement
			const route = document.querySelector('dashboard-route') as HTMLElement
			const tallerThanViewport: string[] = []
			for (
				let el = scroll.parentElement;
				el && el !== viewportEl;
				el = el.parentElement
			) {
				if (
					el.getBoundingClientRect().height >
					viewportEl.getBoundingClientRect().height + 1
				) {
					tallerThanViewport.push(el.tagName.toLowerCase())
				}
			}
			return {
				routeDisplay: getComputedStyle(route).display,
				routeHeight: route.getBoundingClientRect().height,
				viewportHeight: viewportEl.getBoundingClientRect().height,
				scrollOverflow: getComputedStyle(scroll).overflowY,
				tallerThanViewport,
			}
		})
		expect(chain.routeDisplay).toBe('grid')
		expect(chain.routeHeight).toBeLessThanOrEqual(chain.viewportHeight + 1)
		expect(chain.scrollOverflow).toBe('auto')
		expect(chain.tallerThanViewport).toEqual([])

		// Scrolled to the end of the list, the nav has not moved.
		await page.evaluate(() => {
			const scroll = document.querySelector(
				'[data-testid="concert-scroll"]',
			) as HTMLElement
			scroll.scrollTop = scroll.scrollHeight
		})
		await navIsPinned()
	})

	test(`@spec ${APP_SHELL} "Stage header stays fixed above scrollable content"`, async ({
		page,
	}) => {
		await openDashboard(page)
		const header = page.locator('concert-highway .stage-header')
		await expect(header).toBeVisible()
		await expect(header).toContainText(/home/i)
		await expect(header).toContainText(/near/i)
		await expect(header).toContainText(/away/i)

		const layout = await page.evaluate(() => {
			const highway = document.querySelector('concert-highway') as HTMLElement
			const head = highway.querySelector('.stage-header') as HTMLElement
			const scroll = highway.querySelector(
				'[data-testid="concert-scroll"]',
			) as HTMLElement
			const lane = scroll.querySelector('.lane-grid') as HTMLElement
			const columns = (el: Element) =>
				getComputedStyle(el).gridTemplateColumns.split(' ').length
			return {
				tag: head.tagName.toLowerCase(),
				insideScroll: scroll.contains(head),
				highwayAreas: getComputedStyle(highway).gridTemplateAreas,
				// A subgrid reports the parent's resolved tracks, three lanes here.
				headerColumns: columns(head),
				headerSpan: [
					getComputedStyle(head).gridColumnStart,
					getComputedStyle(head).gridColumnEnd,
				],
				scrollColumns: columns(scroll),
				laneColumns: columns(lane),
			}
		})
		expect(layout.tag).toBe('header')
		expect(layout.insideScroll).toBe(false)
		expect(layout.highwayAreas).toBe(
			'"stage-home stage-near stage-away" "lane-home lane-near lane-away"',
		)
		expect(layout.headerSpan).toEqual(['stage-home', 'stage-away'])
		expect(layout.headerColumns).toBe(3)
		expect(layout.scrollColumns).toBe(3)
		expect(layout.laneColumns).toBe(3)

		const before = await header.boundingBox()
		await page.evaluate(() => {
			const scroll = document.querySelector(
				'[data-testid="concert-scroll"]',
			) as HTMLElement
			scroll.scrollTop = scroll.scrollHeight
		})
		const after = await header.boundingBox()
		const scrollBox = await page
			.locator('[data-testid="concert-scroll"]')
			.boundingBox()
		expect(before).not.toBeNull()
		expect(after).not.toBeNull()
		expect(scrollBox).not.toBeNull()
		if (!before || !after || !scrollBox) return
		// The header did not move, and the scrolled content stays below it.
		expect(after.y).toBeCloseTo(before.y, 0)
		expect(after.y + after.height).toBeLessThanOrEqual(scrollBox.y + 1)
	})

	test(`@spec ${APP_SHELL} "Scroll container is properly constrained"`, async ({
		page,
	}) => {
		await openDashboard(page)
		const result = await page.evaluate(() => {
			const scroll = document.querySelector(
				'[data-testid="concert-scroll"]',
			) as HTMLElement
			// Every ancestor up to the document root that could scroll.
			const otherScrollers: string[] = []
			for (let el = scroll.parentElement; el; el = el.parentElement) {
				const { overflowY } = getComputedStyle(el)
				const scrolls =
					el.scrollHeight > el.clientHeight + 1 &&
					(overflowY === 'auto' || overflowY === 'scroll')
				if (scrolls) otherScrollers.push(el.tagName.toLowerCase())
			}
			return {
				overflows: scroll.scrollHeight > scroll.clientHeight,
				overscroll: getComputedStyle(scroll).overscrollBehaviorY,
				otherScrollers,
				documentScrolls:
					(document.scrollingElement?.scrollHeight ?? 0) >
					(document.scrollingElement?.clientHeight ?? 0) + 1,
			}
		})
		expect(result.overflows).toBe(true)
		expect(result.otherScrollers).toEqual([])
		expect(result.documentScrolls).toBe(false)
		expect(result.overscroll).toBe('contain')
	})
})
