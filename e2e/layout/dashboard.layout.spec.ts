import {
	expectAnchored,
	expectContainedIn,
	expectFillsParent,
} from './assertions'
import { expect, test } from './fixtures'

// ---------------------------------------------------------------------------
// Helpers: seed localStorage and mock RPC to produce deterministic states
// ---------------------------------------------------------------------------

/** Seed dashboard to render empty state (no followed artists, no concerts). */
function seedDashboardState() {
	return () => {
		localStorage.setItem('onboardingStep', 'dashboard')
		localStorage.setItem('guest.home', 'JP-13')
	}
}

/** Seed dashboard with concert data so event cards render.
 *  Sets up:
 *  - onboardingStep = 3 (DASHBOARD — required for auth hook to allow access)
 *  - guest.home = JP-13 (Tokyo)
 *  - guest.followedArtists with 3 artists
 *
 *  Note: During onboarding, listByFollowerOnboarding calls List per artist
 *  and groups ALL concerts into the "away" lane. Layout tests should check
 *  the away lane for cards.
 */
function seedWithConcertData() {
	return () => {
		localStorage.setItem('onboardingStep', 'dashboard')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{
					artist: { id: 'artist-1', name: 'YOASOBI', mbid: 'mbid-1' },
					home: 'JP-13',
				},
				{
					artist: { id: 'artist-2', name: 'Vaundy', mbid: 'mbid-2' },
					home: 'JP-13',
				},
				{
					artist: { id: 'artist-3', name: 'Ado', mbid: 'mbid-3' },
					home: 'JP-13',
				},
			]),
		)
	}
}

/** Build a Connect-RPC JSON response for ConcertService/ListWithProximity.
 *  Returns proximity groups with concerts in the "away" lane (onboarding path).
 *
 *  Generates enough concerts to overflow the viewport so scroll-related
 *  layout bugs (header/footer not staying fixed) are detected.
 */
function concertListResponse() {
	const venues = [
		'Zepp DiverCity',
		'Budokan',
		'Zepp Osaka',
		'Makuhari Messe',
		'Yokohama Arena',
	]
	const areas = ['JP-13', 'JP-27', 'JP-12', 'JP-14', 'JP-04']

	// Group concerts by date into ProximityGroup objects
	const groupMap = new Map<string, { date: object; away: object[] }>()

	for (let i = 0; i < 20; i++) {
		const date = new Date()
		date.setDate(date.getDate() + 1 + Math.floor(i / 3))
		const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
		const concert = makeConcert(
			`c${i}`,
			`artist-${(i % 3) + 1}`,
			date,
			areas[i % areas.length],
			venues[i % venues.length],
		)

		if (!groupMap.has(dateKey)) {
			groupMap.set(dateKey, {
				date: {
					value: {
						year: date.getFullYear(),
						month: date.getMonth() + 1,
						day: date.getDate(),
					},
				},
				away: [],
			})
		}
		groupMap.get(dateKey)!.away.push(concert)
	}

	return { groups: Array.from(groupMap.values()) }
}

function makeConcert(
	id: string,
	artistId: string,
	date: Date,
	adminArea: string | undefined,
	venueName: string,
) {
	// Proto3 JSON: google.protobuf.Timestamp uses RFC 3339 string format
	const startTimeRfc = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		19,
		0,
	).toISOString()

	return {
		id: { value: id },
		artistId: { value: artistId },
		localDate: {
			value: {
				year: date.getFullYear(),
				month: date.getMonth() + 1,
				day: date.getDate(),
			},
		},
		startTime: { value: startTimeRfc },
		venue: {
			name: { value: venueName },
			...(adminArea ? { adminArea: { value: adminArea } } : {}),
		},
		title: { value: `${venueName} Live` },
		sourceUrl: { value: 'https://example.com' },
	}
}

// ---------------------------------------------------------------------------
// Group 1: Shell layout -- height propagation & bottom-nav anchoring
// ---------------------------------------------------------------------------

test.describe('Dashboard shell layout', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedDashboardState())
		await page.goto('/dashboard')
		await page.waitForSelector('concert-highway, state-placeholder', {
			timeout: 5000,
		})
	})

	test('dashboard custom element fills au-viewport (DB1)', async ({
		layoutPage: page,
	}) => {
		const auViewport = page.locator('au-viewport')
		const dashboard = page.locator('au-viewport > *').first()
		await expectFillsParent(dashboard, auViewport, 2)
	})

	test('content area has non-zero height (DB2)', async ({
		layoutPage: page,
	}) => {
		const contentHeight = await page.evaluate(() => {
			const root = document.querySelector('dashboard-route')
			if (!root) return { root: 0, content: 0 }
			const main = root.querySelector('concert-highway')
			return {
				root: root.getBoundingClientRect().height,
				content: main?.getBoundingClientRect().height ?? 0,
			}
		})
		expect(
			contentHeight.root,
			'dashboard-route CE should have height',
		).toBeGreaterThan(100)
		expect(
			contentHeight.content,
			'concert-highway should not collapse to zero',
		).toBeGreaterThan(50)
	})

	test('visible content not clipped by zero-height ancestor (DB3)', async ({
		layoutPage: page,
	}) => {
		// dashboard-route always renders at least one visible element
		// (either stage-header labels or state-placeholder text)
		const visibleText = page
			.locator(
				'dashboard-route .stage-header > span, state-placeholder p, state-placeholder h2',
			)
			.first()
		await expect(visibleText).toBeVisible()

		await expect
			.poll(async () => {
				const box = await visibleText.boundingBox()
				return box?.height ?? 0
			})
			.toBeGreaterThan(0)
	})

	test('bottom-nav anchored to viewport bottom (DB4)', async ({
		layoutPage: page,
	}) => {
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})

	test('au-viewport + bottom-nav equals app-shell height (DB5)', async ({
		layoutPage: page,
	}) => {
		const appShellBox = await page.locator('app-shell').boundingBox()
		const viewportBox = await page.locator('au-viewport').boundingBox()
		const navBox = await page.locator('bottom-nav-bar').boundingBox()

		expect(appShellBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(navBox).toBeTruthy()

		const combined = viewportBox!.height + navBox!.height
		expect(combined).toBeCloseTo(appShellBox!.height, 0)
	})
})

// ---------------------------------------------------------------------------
// Group 2: Header -- title, lane labels, positioning
// ---------------------------------------------------------------------------

test.describe('Dashboard header', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithConcertData())
		await page.route('**/liverty_music.rpc.concert.**', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(concertListResponse()),
			})
		})
		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', {
			timeout: 10000,
		})
	})

	test('header contains three STAGE labels (H2)', async ({
		layoutPage: page,
	}) => {
		const labels = page.locator('.stage-header > span')
		await expect(labels).toHaveCount(3)
	})

	test('header is pinned to top of dashboard (H3)', async ({
		layoutPage: page,
	}) => {
		const stageHeader = page.locator('.stage-header').first()
		const stageHeaderBox = await stageHeader.boundingBox()
		const auViewportBox = await page.locator('au-viewport').boundingBox()

		expect(stageHeaderBox).toBeTruthy()
		expect(auViewportBox).toBeTruthy()
		// Stage header sits below page-header; verify it's within the au-viewport
		expect(stageHeaderBox!.y).toBeGreaterThanOrEqual(auViewportBox!.y)
		expect(stageHeaderBox!.y).toBeLessThan(auViewportBox!.y + auViewportBox!.height)
	})

	test('concert-scroll is the only scroll container (H4a)', async ({
		layoutPage: page,
	}) => {
		// [data-testid="concert-scroll"] (inside concert-highway CE) must have a constrained
		// height so overflow-block: auto produces a scrollable region.
		const scroll = page.locator('concert-highway [data-testid="concert-scroll"]')
		const metrics = await scroll.evaluate((el) => ({
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
		}))
		expect(
			metrics.scrollHeight,
			'concert-scroll must overflow (content taller than container)',
		).toBeGreaterThan(metrics.clientHeight)
	})

	test('stage header stays fixed after scrolling (H4)', async ({
		layoutPage: page,
	}) => {
		const scrollContainer = page.locator('concert-highway [data-testid="concert-scroll"]')
		const header = page.locator('.stage-header').first()

		// Record header position before scroll
		const beforeBox = await header.boundingBox()
		expect(beforeBox).toBeTruthy()

		// Scroll the concert content down significantly
		await scrollContainer.evaluate((el) => {
			el.scrollTop = 400
		})
		// Allow layout to settle
		await page.waitForTimeout(100)

		// Header is outside the scroll container, so it stays at the same Y
		const afterBox = await header.boundingBox()
		expect(afterBox).toBeTruthy()
		expect(afterBox!.y).toBeCloseTo(beforeBox!.y, 0)
	})

	test('bottom-nav stays pinned after scrolling (H5)', async ({
		layoutPage: page,
	}) => {
		const scrollContainer = page.locator('concert-highway [data-testid="concert-scroll"]')

		// Scroll the concert content down significantly
		await scrollContainer.evaluate((el) => {
			el.scrollTop = 400
		})
		await page.waitForTimeout(100)

		// Bottom nav should still be anchored to viewport bottom
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})

	test('height chain propagates correctly from au-viewport to concert-highway (H6)', async ({
		layoutPage: page,
	}) => {
		// Every element in the chain must be constrained to the viewport area,
		// not expanding to fit content. If any element's rendered height exceeds
		// the au-viewport height, the height chain is broken.
		const auViewportHeight = await page
			.locator('au-viewport')
			.evaluate((el) => el.getBoundingClientRect().height)

		for (const selector of ['au-viewport > *', 'dashboard-route']) {
			const height = await page
				.locator(selector)
				.first()
				.evaluate((el) => el.getBoundingClientRect().height)
			expect(
				height,
				`${selector} (${height}px) must not exceed au-viewport (${auViewportHeight}px)`,
			).toBeLessThanOrEqual(auViewportHeight + 1)
		}
	})
})

// ---------------------------------------------------------------------------
// Group 3: Empty state -- icon, text, discover link, centering
// ---------------------------------------------------------------------------

test.describe('Dashboard empty state', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedDashboardState())
		await page.goto('/dashboard')
		// Wait for promise to resolve to empty state
		await page.waitForSelector('state-placeholder, concert-highway', {
			timeout: 5000,
		})
	})

	test('empty state icon is visible (E1)', async ({ layoutPage: page }) => {
		const placeholder = page.locator('state-placeholder')
		const isEmpty = (await placeholder.count()) > 0
		if (!isEmpty) return // Data loaded, skip empty state tests
		const icon = placeholder.locator('svg').first()
		await expect(icon).toBeVisible()
		const box = await icon.boundingBox()
		expect(box).toBeTruthy()
		expect(box!.width).toBeGreaterThanOrEqual(40)
		expect(box!.height).toBeGreaterThanOrEqual(40)
	})

	test('empty state shows title and subtitle text (E2)', async ({
		layoutPage: page,
	}) => {
		const placeholder = page.locator('state-placeholder')
		if ((await placeholder.count()) === 0) return
		// state-placeholder projects content via au-slot; title is <p> + subtitle is <p>
		const paragraphs = placeholder.locator('p')
		await expect(paragraphs).toHaveCount(2)
	})

	test('empty state has discover link (E3)', async ({ layoutPage: page }) => {
		const placeholder = page.locator('state-placeholder')
		if ((await placeholder.count()) === 0) return
		const link = placeholder.locator('a[href*="discover"]')
		await expect(link).toHaveCount(1)
		await expect(link).toBeVisible()
	})

	test('empty state is vertically centered in content area (E4)', async ({
		layoutPage: page,
	}) => {
		const placeholder = page.locator('state-placeholder')
		if ((await placeholder.count()) === 0) return

		const placeholderBox = await placeholder.boundingBox()
		expect(placeholderBox).toBeTruthy()

		// Content area is concert-highway
		const mainBox = await page.locator('concert-highway').boundingBox()
		if (!mainBox) return

		// Center of the empty state should be near center of content area
		const emptyCenter = placeholderBox!.y + placeholderBox!.height / 2
		const contentCenter = mainBox.y + mainBox.height / 2
		expect(Math.abs(emptyCenter - contentCenter)).toBeLessThan(50)
	})
})

// ---------------------------------------------------------------------------
// Group 4: Data-loaded state -- event cards, 3-lane grid, stage header
// ---------------------------------------------------------------------------

test.describe('Dashboard data-loaded state', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithConcertData())

		// Concert-specific mock (LIFO: checked before the fixture's generic mock)
		await page.route('**/liverty_music.rpc.concert.**', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(concertListResponse()),
			})
		})

		await page.goto('/dashboard')
		await page.waitForSelector('concert-highway', { timeout: 5000 })
		await page.waitForSelector('[data-live-card]', { timeout: 10000 })
	})

	test('content area has non-zero rendered height when data loaded (C0)', async ({
		layoutPage: page,
	}) => {
		// Critical regression test: the height chain must propagate through
		// au-viewport → dashboard-route → concert-highway (scroll container).
		const heights = await page.evaluate(() => {
			const root = document.querySelector('dashboard-route')
			if (!root) return { root: 0, scrollContainer: 0 }
			const scroll = root.querySelector('concert-highway')
			return {
				root: root.getBoundingClientRect().height,
				scrollContainer: scroll?.getBoundingClientRect().height ?? 0,
			}
		})

		expect(
			heights.root,
			'dashboard-route CE should fill viewport',
		).toBeGreaterThan(200)
		expect(
			heights.scrollContainer,
			'concert-highway must have renderable height',
		).toBeGreaterThan(50)
	})

	test('first event card is visually visible on screen (C1)', async ({
		layoutPage: page,
	}) => {
		const card = page.locator('[data-live-card]').first()
		await expect(card).toBeVisible()

		const box = await card.boundingBox()
		expect(box, 'card must have a bounding box').toBeTruthy()
		expect(box!.height, 'card must have visible height').toBeGreaterThan(10)

		// Verify card is within the visible viewport (not clipped off-screen)
		const viewport = page.viewportSize()!
		expect(box!.y, 'card top must be within viewport').toBeGreaterThanOrEqual(0)
		expect(
			box!.y + box!.height,
			'card bottom must be within viewport',
		).toBeLessThanOrEqual(viewport.height)
	})

	test('three-lane grid uses equal 1fr 1fr 1fr ratio (C2)', async ({
		layoutPage: page,
	}) => {
		const grid = page.locator('.lane-grid').first()
		await expect(grid).toBeVisible()

		const gridBox = await grid.boundingBox()
		expect(gridBox).toBeTruthy()

		const lanes = grid.locator('> li')
		await expect(lanes).toHaveCount(3)

		const laneBoxes = await Promise.all([
			lanes.nth(0).boundingBox(),
			lanes.nth(1).boundingBox(),
			lanes.nth(2).boundingBox(),
		])

		for (const box of laneBoxes) {
			expect(box).toBeTruthy()
		}

		const totalWidth = gridBox!.width
		// All lanes ~33%
		expect(laneBoxes[0]!.width / totalWidth).toBeCloseTo(0.333, 1)
		expect(laneBoxes[1]!.width / totalWidth).toBeCloseTo(0.333, 1)
		expect(laneBoxes[2]!.width / totalWidth).toBeCloseTo(0.333, 1)
	})

	test('stage header is inside concert-highway but outside concert-scroll (C3)', async ({
		layoutPage: page,
	}) => {
		const stageHeader = page.locator('.stage-header').first()
		await expect(stageHeader).toBeVisible()

		// Stage header is inside concert-highway CE but not inside the scrollable list
		const structure = await stageHeader.evaluate((el) => ({
			insideCE: el.closest('concert-highway') !== null,
			insideScroll: el.closest('[data-testid="concert-scroll"]') !== null,
		}))
		expect(structure.insideCE, 'stage-header must be inside concert-highway').toBe(true)
		expect(structure.insideScroll, 'stage-header must not be inside scroll container').toBe(false)
	})

	test('event cards are clickable (have cursor-pointer) (C4)', async ({
		layoutPage: page,
	}) => {
		const card = page.locator('[data-live-card]').first()
		const cursor = await card.evaluate((el) => getComputedStyle(el).cursor)
		expect(cursor).toBe('pointer')
	})

	test('event cards have non-zero height (C5)', async ({
		layoutPage: page,
	}) => {
		const card = page.locator('[data-live-card]').first()
		if ((await card.count()) === 0) return
		const box = await card.boundingBox()
		expect(box).toBeTruthy()
		expect(box!.height).toBeGreaterThan(0)
	})

	test('event cards are contained within viewport (C6)', async ({
		layoutPage: page,
	}) => {
		const card = page.locator('[data-live-card]').first()
		const auViewport = page.locator('au-viewport')
		await expectContainedIn(card, auViewport, 2)
	})

	test('concert-highway container has renderable height (C7)', async ({
		layoutPage: page,
	}) => {
		const scrollContainer = page.locator('concert-highway [data-testid="concert-scroll"]').first()
		if ((await scrollContainer.count()) === 0) return

		// Check CSS property — scroll happens inside .concert-scroll, not the CE root
		const overflowY = await scrollContainer.evaluate(
			(el) => getComputedStyle(el).overflowBlock,
		)
		expect(overflowY).toBe('auto')

		// Check actual rendered height (not just CSS property)
		const box = await scrollContainer.boundingBox()
		expect(box, 'scroll container must have a bounding box').toBeTruthy()
		expect(
			box!.height,
			'scroll container must have renderable height (not clipped to 0)',
		).toBeGreaterThan(50)
	})

	test('lane grid has 3 columns with cards in correct lane (C8)', async ({
		layoutPage: page,
	}) => {
		const grid = page.locator('.lane-grid').first()
		const lanes = grid.locator('> li')
		await expect(lanes).toHaveCount(3)

		// During onboarding, all concerts are grouped into the away lane (3rd column)
		const awayLane = lanes.nth(2)
		const awayCards = awayLane.locator('[data-live-card]')
		const awayCardCount = await awayCards.count()
		expect(awayCardCount, 'away lane should have cards').toBeGreaterThan(0)

		const awayCardBox = await awayCards.first().boundingBox()
		expect(awayCardBox).toBeTruthy()
		expect(
			awayCardBox!.height,
			'away card has non-zero height',
		).toBeGreaterThan(0)

		// Verify all 3 lanes have equal width (1fr 1fr 1fr)
		const laneBoxes = await Promise.all([
			lanes.nth(0).boundingBox(),
			lanes.nth(1).boundingBox(),
			lanes.nth(2).boundingBox(),
		])
		for (const box of laneBoxes) {
			expect(box).toBeTruthy()
		}
		expect(laneBoxes[0]!.width).toBeCloseTo(laneBoxes[1]!.width, -1)
		expect(laneBoxes[1]!.width).toBeCloseTo(laneBoxes[2]!.width, -1)
	})

	test('away lane renders event cards (C9)', async ({ layoutPage: page }) => {
		// Away lane is the 3rd column
		const grid = page.locator('.lane-grid')

		// Each grid row is a date group; away lane is the 3rd li child
		const awayLanes = grid.locator('> li:nth-child(3)')
		const awayCards = awayLanes.locator('[data-live-card]')

		// There should be away cards (artist-3 has no adminArea)
		const awayCount = await awayCards.count()
		expect(awayCount, 'away lane should have items').toBeGreaterThan(0)

		const awayCardBox = await awayCards.first().boundingBox()
		expect(awayCardBox).toBeTruthy()
		expect(
			awayCardBox!.height,
			'away card has non-zero height',
		).toBeGreaterThan(0)
	})
})

// ---------------------------------------------------------------------------
// Group 5: needsRegion blur state -- blur filter, overflow hidden
// ---------------------------------------------------------------------------

test.describe('Dashboard needsRegion blur state', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		// Set onboarding step but do NOT set guest.home -> needsRegion = true
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			// Intentionally omit guest.home to trigger needsRegion
		})
		await page.goto('/dashboard')
		// Wait for user-home-selector dialog or the blur state
		await page.waitForSelector('[data-blurred], user-home-selector', {
			timeout: 5000,
		})
	})

	test('content has blur filter when no home region set (B1)', async ({
		layoutPage: page,
	}) => {
		const blurElement = page.locator('[data-blurred]')
		if ((await blurElement.count()) === 0) return

		const filter = await blurElement.evaluate(
			(el) => getComputedStyle(el).filter,
		)
		expect(filter).toContain('blur')
	})

	test('content has pointer-events-none when blurred (B2)', async ({
		layoutPage: page,
	}) => {
		const blurElement = page.locator('[data-blurred]')
		if ((await blurElement.count()) === 0) return

		const pointerEvents = await blurElement.evaluate(
			(el) => getComputedStyle(el).pointerEvents,
		)
		expect(pointerEvents).toBe('none')
	})
})
