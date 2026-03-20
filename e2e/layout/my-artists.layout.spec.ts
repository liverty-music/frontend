import { expectAnchored, expectFillsParent } from './assertions'
import { expect, test } from './fixtures'

// ---------------------------------------------------------------------------
// Helpers: seed localStorage so my-artists renders with deterministic state
// ---------------------------------------------------------------------------

/** Seed with followed artists so the list view renders.
 *  onboardingStep = 5 (MY_ARTISTS) keeps isOnboarding=true so the auth hook
 *  allows access to /my-artists (tutorialStep: 5) without real authentication.
 */
function seedWithArtists() {
	return () => {
		localStorage.setItem('onboardingStep', '5')
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

/** Seed with no followed artists to trigger the empty state. */
function seedEmpty() {
	return () => {
		localStorage.setItem('onboardingStep', '5')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('guest.followedArtists', JSON.stringify([]))
	}
}

// ---------------------------------------------------------------------------
// Group 1: Shell layout — height propagation & bottom-nav anchoring
// ---------------------------------------------------------------------------

test.describe('My Artists shell layout', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithArtists())
		await page.goto('/my-artists')
		await page.waitForSelector('my-artists-route .artist-list', {
			timeout: 5000,
		})
	})

	test('my-artists-route fills au-viewport (MA1)', async ({
		layoutPage: page,
	}) => {
		const auViewport = page.locator('au-viewport')
		const myArtists = page.locator('au-viewport > *').first()
		await expectFillsParent(myArtists, auViewport, 2)
	})

	test('bottom-nav anchored to viewport bottom (MA2)', async ({
		layoutPage: page,
	}) => {
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})

	test('main has non-zero height (MA3)', async ({ layoutPage: page }) => {
		const main = page.locator('my-artists-route main')
		const box = await main.boundingBox()
		expect(box, 'main should have a bounding box').toBeTruthy()
		expect(box!.height, 'main should have visible height').toBeGreaterThan(100)
	})
})

// ---------------------------------------------------------------------------
// Group 2: Header — title, artist count
// ---------------------------------------------------------------------------

test.describe('My Artists header', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithArtists())
		await page.goto('/my-artists')
		await page.waitForSelector('my-artists-route page-header', {
			timeout: 5000,
		})
	})

	test('header contains h1 title (MA-H1)', async ({ layoutPage: page }) => {
		const h1 = page.locator('my-artists-route page-header h1')
		await expect(h1).toBeVisible()
	})

	test('header shows artist count (MA-H2)', async ({ layoutPage: page }) => {
		const count = page.locator('my-artists-route .artist-count')
		await expect(count).toBeVisible()
		const text = await count.textContent()
		expect(text).toContain('3')
	})
})

// ---------------------------------------------------------------------------
// Group 3: List view — artist rows, hype legend, scroll behavior
// ---------------------------------------------------------------------------

test.describe('My Artists list view', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithArtists())
		await page.goto('/my-artists')
		await page.waitForSelector('my-artists-route .artist-list', {
			timeout: 5000,
		})
	})

	test('artist list renders 3 rows (MA-L1)', async ({ layoutPage: page }) => {
		const rows = page.locator('my-artists-route .artist-list .artist-row')
		await expect(rows).toHaveCount(3)
	})

	test('hype legend is visible above artist list (MA-L2)', async ({
		layoutPage: page,
	}) => {
		const legend = page.locator('my-artists-route .hype-legend')
		const list = page.locator('my-artists-route .artist-list')

		const legendBox = await legend.boundingBox()
		const listBox = await list.boundingBox()

		expect(legendBox).toBeTruthy()
		expect(listBox).toBeTruthy()
		expect(
			legendBox!.y + legendBox!.height,
			'legend bottom should be at or above list top',
		).toBeLessThanOrEqual(listBox!.y + 2)
	})

	test('artist list does not overflow below bottom-nav (MA-L3)', async ({
		layoutPage: page,
	}) => {
		const list = page.locator('my-artists-route .artist-list')
		const nav = page.locator('bottom-nav-bar')

		const listBox = await list.boundingBox()
		const navBox = await nav.boundingBox()

		expect(listBox).toBeTruthy()
		expect(navBox).toBeTruthy()
		expect(
			listBox!.y + listBox!.height,
			'artist-list bottom should not exceed bottom-nav top',
		).toBeLessThanOrEqual(navBox!.y + 2)
	})

	test('artist row names are visible (MA-L4)', async ({ layoutPage: page }) => {
		const names = page.locator('my-artists-route .artist-row-name')
		const count = await names.count()
		expect(count).toBe(3)
		for (let i = 0; i < count; i++) {
			await expect(names.nth(i)).toBeVisible()
		}
	})
})

// ---------------------------------------------------------------------------
// Group 4: Empty state — state-placeholder, discover button
// ---------------------------------------------------------------------------

test.describe('My Artists empty state', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedEmpty())
		await page.goto('/my-artists')
		await page.waitForSelector('my-artists-route state-placeholder', {
			timeout: 5000,
		})
	})

	test('empty state placeholder is visible (MA-E1)', async ({
		layoutPage: page,
	}) => {
		const placeholder = page.locator('my-artists-route state-placeholder')
		await expect(placeholder).toBeVisible()
	})

	test('empty state has discover button (MA-E2)', async ({
		layoutPage: page,
	}) => {
		const btn = page.locator('my-artists-route state-placeholder .discover-btn')
		await expect(btn).toBeVisible()
	})

	test('empty state is vertically centered in main (MA-E3)', async ({
		layoutPage: page,
	}) => {
		const placeholder = page.locator('my-artists-route state-placeholder')
		const main = page.locator('my-artists-route main')

		const placeholderBox = await placeholder.boundingBox()
		const mainBox = await main.boundingBox()

		expect(placeholderBox).toBeTruthy()
		expect(mainBox).toBeTruthy()

		const emptyCenter = placeholderBox!.y + placeholderBox!.height / 2
		const mainCenter = mainBox!.y + mainBox!.height / 2
		expect(Math.abs(emptyCenter - mainCenter)).toBeLessThan(50)
	})

	test('header is hidden when no artists (MA-E4)', async ({
		layoutPage: page,
	}) => {
		const header = page.locator('my-artists-route page-header')
		await expect(header).toHaveCount(0)
	})

	test('bottom-nav stays anchored during empty state (MA-E5)', async ({
		layoutPage: page,
	}) => {
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})
})
