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
		localStorage.setItem('onboardingStep', '3')
		localStorage.setItem('guest.home', 'JP-13')
	}
}

/** Seed dashboard with concert data so live-highway renders event cards.
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
		localStorage.setItem('onboardingStep', '3')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ id: 'artist-1', name: 'YOASOBI', passionLevel: 'MUST_GO' },
				{ id: 'artist-2', name: 'Vaundy', passionLevel: 'LOCAL_ONLY' },
				{ id: 'artist-3', name: 'Ado', passionLevel: 'KEEP_AN_EYE' },
			]),
		)
	}
}

/** Build a Connect-RPC JSON response for ConcertService/List (per artist).
 *  During onboarding, each artist's concerts are fetched separately via List,
 *  then merged and grouped by date into the "away" lane.
 */
function concertListResponse() {
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)

	return {
		concerts: [
			makeConcert('c1', 'artist-1', tomorrow, 'JP-13', 'Zepp DiverCity'),
		],
	}
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
		await page.waitForSelector('live-highway, [class*="justify-center"]', {
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
			const root = document.querySelector('au-viewport > * > .flex.flex-col')
			if (!root) return { root: 0, content: 0 }
			const children = root.children
			const content = children[children.length - 1] as HTMLElement
			return {
				root: root.getBoundingClientRect().height,
				content: content?.getBoundingClientRect().height ?? 0,
			}
		})
		expect(
			contentHeight.root,
			'root flex column should have height',
		).toBeGreaterThan(100)
		expect(
			contentHeight.content,
			'content area should not collapse to zero',
		).toBeGreaterThan(50)
	})

	test('visible content not clipped by zero-height ancestor (DB3)', async ({
		layoutPage: page,
	}) => {
		const visibleText = page
			.locator(
				'au-viewport h1, au-viewport p, au-viewport [class*="font-display"]',
			)
			.first()
		await expect(visibleText).toBeVisible()

		const box = await visibleText.boundingBox()
		expect(box, 'text element should have a bounding box').toBeTruthy()
		expect(box!.height).toBeGreaterThan(0)
	})

	test('bottom-nav anchored to viewport bottom (DB4)', async ({
		layoutPage: page,
	}) => {
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})

	test('au-viewport + bottom-nav equals my-app height (DB5)', async ({
		layoutPage: page,
	}) => {
		const myAppBox = await page.locator('my-app').boundingBox()
		const viewportBox = await page.locator('au-viewport').boundingBox()
		const navBox = await page.locator('bottom-nav-bar').boundingBox()

		expect(myAppBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(navBox).toBeTruthy()

		const combined = viewportBox!.height + navBox!.height
		expect(combined).toBeCloseTo(myAppBox!.height, 0)
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
		await page.waitForSelector('live-highway [data-live-card]', {
			timeout: 10000,
		})
	})

	test('header contains three STAGE labels (H2)', async ({
		layoutPage: page,
	}) => {
		const labels = page.locator('live-highway .sticky.top-0.grid.grid-cols-3 span')
		await expect(labels).toHaveCount(3)
	})

	test('header is pinned to top of dashboard (H3)', async ({
		layoutPage: page,
	}) => {
		const header = page.locator('live-highway .sticky.top-0.grid.grid-cols-3').first()
		const headerBox = await header.boundingBox()
		const auViewportBox = await page.locator('au-viewport').boundingBox()

		expect(headerBox).toBeTruthy()
		expect(auViewportBox).toBeTruthy()
		// Header top should align with au-viewport top
		expect(headerBox!.y).toBeCloseTo(auViewportBox!.y, 0)
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
		await page.waitForSelector('[class*="justify-center"] svg, live-highway', {
			timeout: 5000,
		})
	})

	test('empty state icon is visible (E1)', async ({ layoutPage: page }) => {
		const icon = page.locator('[class*="justify-center"] svg').first()
		// Only check if empty state is shown (no followed artists -> empty)
		const isEmpty = (await icon.count()) > 0
		if (!isEmpty) return // Data loaded, skip empty state tests
		await expect(icon).toBeVisible()
		const box = await icon.boundingBox()
		expect(box).toBeTruthy()
		expect(box!.width).toBeGreaterThanOrEqual(40)
		expect(box!.height).toBeGreaterThanOrEqual(40)
	})

	test('empty state shows title and subtitle text (E2)', async ({
		layoutPage: page,
	}) => {
		// Scope to dashboard's empty state (has text-center, distinguishing from live-highway's)
		const emptyContainer = page.locator(
			'au-viewport .text-center.items-center.justify-center',
		)
		if ((await emptyContainer.count()) === 0) return
		const paragraphs = emptyContainer.locator('p')
		await expect(paragraphs).toHaveCount(2)
	})

	test('empty state has discover link (E3)', async ({ layoutPage: page }) => {
		// Aurelia router resolves href="/discover" relative to current route
		const emptyContainer = page.locator(
			'au-viewport .text-center.items-center.justify-center',
		)
		if ((await emptyContainer.count()) === 0) return
		const link = emptyContainer.locator('a[href*="discover"]')
		await expect(link).toHaveCount(1)
		await expect(link).toBeVisible()
	})

	test('empty state is vertically centered in content area (E4)', async ({
		layoutPage: page,
	}) => {
		// Scope to dashboard's empty state (has text-center + px-6)
		const emptyContainer = page.locator(
			'au-viewport .text-center.items-center.justify-center.px-6',
		)
		if ((await emptyContainer.count()) === 0) return

		const containerBox = await emptyContainer.boundingBox()
		expect(containerBox).toBeTruthy()

		// Content area is the parent (promise.bind div)
		const contentBox = await emptyContainer.locator('..').boundingBox()
		if (!contentBox) return

		// Center of the empty state should be near center of content area
		const emptyCenter = containerBox!.y + containerBox!.height / 2
		const contentCenter = contentBox.y + contentBox.height / 2
		expect(Math.abs(emptyCenter - contentCenter)).toBeLessThan(50)
	})
})

// ---------------------------------------------------------------------------
// Group 4: Data-loaded state -- event cards, 3-lane grid, sticky header
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
		await page.waitForSelector('live-highway', { timeout: 5000 })
		await page.waitForSelector('[data-live-card]', { timeout: 10000 })
	})

	test('content area has non-zero rendered height when data loaded (C0)', async ({
		layoutPage: page,
	}) => {
		// Critical regression test: the height chain must propagate through
		// au-viewport → dashboard → promise.bind div → live-highway → scroll container.
		// Without flex flex-col on promise.bind div, flex-1 collapses to 0px,
		// and live-highway's overflow-y:auto clips all cards invisible.
		const heights = await page.evaluate(() => {
			const root = document.querySelector('au-viewport > * > .flex.flex-col')
			if (!root) return { root: 0, content: 0, scrollContainer: 0 }
			const children = root.children
			const content = children[children.length - 1] as HTMLElement
			const scroll = document.querySelector('.overflow-y-auto')
			return {
				root: root.getBoundingClientRect().height,
				content: content?.getBoundingClientRect().height ?? 0,
				scrollContainer: scroll?.getBoundingClientRect().height ?? 0,
			}
		})

		expect(
			heights.root,
			'dashboard root flex column should fill viewport',
		).toBeGreaterThan(200)
		expect(
			heights.content,
			'content area (flex-1 min-h-0) must not collapse to zero',
		).toBeGreaterThan(100)
		expect(
			heights.scrollContainer,
			'live-highway scroll container must have renderable height',
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
		const grid = page.locator('.grid.grid-cols-3').first()
		await expect(grid).toBeVisible()

		const gridBox = await grid.boundingBox()
		expect(gridBox).toBeTruthy()

		const lanes = grid.locator('> div')
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

	test('sticky date header exists (C3)', async ({ layoutPage: page }) => {
		const stickyHeader = page.locator('live-highway .sticky.top-0.grid.grid-cols-3').first()
		await expect(stickyHeader).toBeVisible()

		const style = await stickyHeader.evaluate(
			(el) => getComputedStyle(el).position,
		)
		expect(style).toBe('sticky')
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

	test('live-highway scroll container has renderable height (C7)', async ({
		layoutPage: page,
	}) => {
		const scrollContainer = page.locator('.overflow-y-auto').first()
		if ((await scrollContainer.count()) === 0) return

		// Check CSS property
		const overflowY = await scrollContainer.evaluate(
			(el) => getComputedStyle(el).overflowY,
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
		const grid = page.locator('live-highway .grid.grid-cols-3:not(.sticky)').first()
		const lanes = grid.locator('> div')
		await expect(lanes).toHaveCount(3)

		// During onboarding, all concerts are grouped into the away lane (3rd column)
		const awayLane = lanes.nth(2)
		const awayCards = awayLane.locator('[data-live-card]')
		const awayCardCount = await awayCards.count()
		expect(awayCardCount, 'away lane should have cards').toBeGreaterThan(0)

		const awayCardBox = await awayCards.first().boundingBox()
		expect(awayCardBox).toBeTruthy()
		expect(awayCardBox!.height, 'away card has non-zero height').toBeGreaterThan(0)

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

	test('away lane renders event cards (C9)', async ({
		layoutPage: page,
	}) => {
		// Away lane is the 3rd column
		const grid = page.locator('live-highway .grid.grid-cols-3:not(.sticky)')

		// Each grid row is a date group; away lane is the 3rd div child
		const awayLanes = grid.locator('> div:nth-child(3)')
		const awayCards = awayLanes.locator('[data-live-card]')

		// There should be away cards (artist-3 has no adminArea)
		const awayCount = await awayCards.count()
		expect(awayCount, 'away lane should have items').toBeGreaterThan(0)

		const awayCardBox = await awayCards.first().boundingBox()
		expect(awayCardBox).toBeTruthy()
		expect(awayCardBox!.height, 'away card has non-zero height').toBeGreaterThan(
			0,
		)
	})
})

// ---------------------------------------------------------------------------
// Group 5: needsRegion blur state -- blur filter, overflow hidden
// ---------------------------------------------------------------------------

test.describe('Dashboard needsRegion blur state', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		// Set onboarding step but do NOT set guest.home -> needsRegion = true
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			// Intentionally omit guest.home to trigger needsRegion
		})
		await page.goto('/dashboard')
		// Wait for user-home-selector dialog or the blur state
		await page.waitForSelector('.blur-sm, user-home-selector', {
			timeout: 5000,
		})
	})

	test('content has blur filter when no home region set (B1)', async ({
		layoutPage: page,
	}) => {
		const blurElement = page.locator('.blur-sm')
		if ((await blurElement.count()) === 0) return

		const filter = await blurElement.evaluate(
			(el) => getComputedStyle(el).filter,
		)
		expect(filter).toContain('blur')
	})

	test('content has pointer-events-none when blurred (B2)', async ({
		layoutPage: page,
	}) => {
		const blurElement = page.locator('.blur-sm')
		if ((await blurElement.count()) === 0) return

		const pointerEvents = await blurElement.evaluate(
			(el) => getComputedStyle(el).pointerEvents,
		)
		expect(pointerEvents).toBe('none')
	})
})
