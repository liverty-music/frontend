import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for the single-flag onboarding model.
 *
 * Onboarding is now ONE persisted boolean (`onboardingComplete`). There is no
 * step machine, no per-screen `onboardingStep` value, no forced ordinal
 * redirects, no blocking overlays, and no consent screen in the flow.
 *
 * Behavioral model these tests assert:
 * - Which screen the user sees is determined by the route they navigate to,
 *   NOT by an onboarding step value. The auth hook is a soft gate (auth-only),
 *   so every application route is reachable at any time.
 * - "Still onboarding" = `onboardingComplete` absent/false. "Completed" =
 *   `onboardingComplete === 'true'`. The legacy `onboardingStep` key is migrated
 *   once on load (`'completed'`/`'7'` → complete; anything else → still
 *   onboarding) but new tests seed the new key directly.
 * - The discovery → dashboard coach mark has no auto-fade: tapping the target
 *   navigates (delegates to the target's native click), while tapping the dimmed
 *   area outside the target light-dismisses it (tap-outside-to-dismiss). It also
 *   dismisses on route detach. It triggers when, while onboarding,
 *   `followedCount >= 5 || artistsWithConcertsCount >= 3`.
 * - My Artists hype change is fully decoupled from onboarding: every tap
 *   applies/persists with no dialog, no step advance, no revert.
 */

// ---------------------------------------------------------------------------
// localStorage seeding helpers (single-flag model)
// ---------------------------------------------------------------------------

/** Seed: still onboarding (new-user default — flag absent → isOnboarding). */
function seedOnboarding(): void {
	localStorage.setItem('onboardingComplete', 'false')
}

/** Seed: onboarding completed. */
function seedCompleted(): void {
	localStorage.setItem('onboardingComplete', 'true')
}

// ---------------------------------------------------------------------------
// RPC mocks
// ---------------------------------------------------------------------------

/** Mock all Connect-RPC requests with empty concert data. */
async function mockRpcRoutesEmpty(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ concerts: [] }),
			})
		}

		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ concerts: [] }),
			})
		}

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{ id: { value: 'a-1' }, name: { value: 'Artist 1' }, hype: 'watch' },
						{ id: { value: 'a-2' }, name: { value: 'Artist 2' }, hype: 'watch' },
						{ id: { value: 'a-3' }, name: { value: 'Artist 3' }, hype: 'watch' },
					],
				}),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/**
 * Mock Connect-RPC with concert data.
 * - ConcertService/List: returns 1 concert per artist (drives
 *   artistsWithConcertsCount >= 3 → coach mark)
 * - ListWithProximity: returns concerts in the away lane
 * - ListFollowed: returns 3 followed artists
 */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					concerts: [
						{
							id: { value: 'c-1' },
							performers: [
								{
									id: { value: 'a-1' },
									name: { value: 'Test Artist' },
									mbid: { value: '' },
								},
							],
							series: {
								id: { value: 's-1' },
								title: { value: 'Test Concert' },
							},
							localDate: { value: { year: 2026, month: 6, day: 15 } },
						},
					],
				}),
			})
		}

		if (url.includes('ListWithProximity')) {
			// Return concerts for 6 preview artists to satisfy
			// PREVIEW_MIN_ARTISTS_WITH_CONCERTS (=5). Performer IDs MUST
			// match `config.json` `previewArtistIds` — otherwise
			// concert-service's `toDateGroups` performer-resolution loop
			// won't find them in the artistMap (built from preview UUIDs),
			// produces `resolved=0`, drops the group, leaves `dateGroups`
			// empty, and the welcome page falls back to the inline-CTA
			// path (no `.welcome-scroll-cta` element).
			const artists = [
				'019c8655-7a05-71ef-82b4-a4ac2494e29f',
				'019c8655-7a05-721d-b0a8-4c11724d5c90',
				'019c8655-7a05-71e9-9af5-e1cd4fbfd367',
				'019c899e-baff-7ecd-8af2-e8dc819e29e4',
				'019c8655-7a05-71f5-acd4-46157dcb0bec',
				'019c8655-7a05-722a-bdae-a89596378f90',
			]
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: artists.map((aid, i) => ({
						date: { value: { year: 2026, month: 6, day: 15 + i } },
						home: [],
						nearby: [],
						away: [
							{
								id: { value: `c-${aid}` },
								performers: [
									{
										id: { value: aid },
										name: { value: `Artist ${i + 1}` },
										mbid: { value: '' },
									},
								],
								series: {
									id: { value: `s-${aid}` },
									title: { value: `Concert ${i + 1}` },
									sourceUrl: { value: '' },
								},
								localDate: {
									value: { year: 2026, month: 6, day: 15 + i },
								},
								venue: {
									name: { value: `Venue ${i + 1}` },
									adminArea: { value: 'JP-13' },
								},
							},
						],
					})),
				}),
			})
		}

		if (url.includes('ListByFollower')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: { value: { year: 2026, month: 6, day: 15 } },
							away: [
								{
									id: { value: 'c-1' },
									performers: [
										{
											id: { value: 'a-1' },
											name: { value: 'Test Artist' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: 's-1' },
										title: { value: 'Test Concert' },
									},
									localDate: { value: { year: 2026, month: 6, day: 15 } },
								},
							],
						},
					],
				}),
			})
		}

		// ConcertService/List — returns 1 concert per artist.
		// Makes concertService.artistsWithConcertsCount >= 3, which (while
		// onboarding) triggers the discovery → dashboard coach mark.
		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					concerts: [
						{
							id: { value: 'c-1' },
							performers: [
								{
									id: { value: 'a-1' },
									name: { value: 'Test Artist' },
									mbid: { value: '' },
								},
							],
							series: {
								id: { value: 's-1' },
								title: { value: 'Test Concert' },
							},
							localDate: { value: { year: 2026, month: 6, day: 15 } },
						},
					],
				}),
			})
		}

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{ id: { value: 'a-1' }, name: { value: 'Artist 1' }, hype: 'watch' },
						{ id: { value: 'a-2' }, name: { value: 'Artist 2' }, hype: 'watch' },
						{ id: { value: 'a-3' }, name: { value: 'Artist 3' }, hype: 'watch' },
					],
				}),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/** Last.fm API mock — returns 10 artists for geo.gettopartists, empty similar. */
async function mockLastFmApi(page: Page): Promise<void> {
	await page.route('**/ws.audioscrobbler.com/**', (route) => {
		const url = new URL(route.request().url())
		const method = url.searchParams.get('method')

		if (method === 'geo.gettopartists') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					topartists: {
						artist: Array.from({ length: 10 }, (_, i) => ({
							name: `Artist ${i + 1}`,
							mbid: `mbid-${i + 1}`,
							image: [
								{ '#text': '', size: 'medium' },
								{ '#text': '', size: 'large' },
							],
							listeners: String(1000 - i * 100),
						})),
					},
				}),
			})
		}

		if (method === 'artist.getsimilar') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ similarartists: { artist: [] } }),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

// ---------------------------------------------------------------------------
// Test suite: individual screen / scenario tests
// ---------------------------------------------------------------------------

test.describe('Onboarding flow (single-flag model)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.removeItem('onboardingComplete')
			localStorage.removeItem('onboardingStep')
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.removeItem('guest.home')
			localStorage.removeItem('guest.followedArtists')
		})
		await mockRpcRoutes(page)
		await mockLastFmApi(page)
	})

	// -------------------------------------------------------------------------
	// Welcome page (entry)
	// -------------------------------------------------------------------------

	test('Welcome page shows scroll affordance above the fold, CTAs on Screen 2', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')

		// Screen 1 shows the [See how it works] scroll-affordance, not [Pick your artists]
		const scrollCta = page.locator('.welcome-scroll-cta')
		await expect(scrollCta).toBeVisible({ timeout: 10_000 })

		// [Pick your artists] is attached (in Screen 2) but not within the initial
		// viewport — assert it exists via toBeAttached (DOM) and does NOT satisfy
		// toBeInViewport (visual position).
		const getStarted = page
			.locator('button')
			.filter({ hasText: /pick your artists/i })
			.first()
		await expect(getStarted).toBeAttached()
		await expect(getStarted).not.toBeInViewport()
	})

	test('Tapping See how it works scrolls to Screen 2, then Pick your artists navigates to Discovery', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')

		// Tap scroll affordance on Screen 1
		await page.locator('.welcome-scroll-cta').click()

		// Screen 2's primary CTA becomes visible after the smooth scroll completes
		const getStarted = page
			.locator('.welcome-screen-2 button')
			.filter({ hasText: /pick your artists/i })
		await expect(getStarted).toBeInViewport({ timeout: 3000 })

		await getStarted.click()
		await expect(page).toHaveURL(/discovery/, { timeout: 10_000 })
	})

	test('Completed: welcome page still exposes the primary CTA on Screen 2', async ({
		page,
	}) => {
		await page.addInitScript(seedCompleted)
		await page.goto('http://localhost:9000/')

		// Screen 2's primary CTA is attached (accessible via scroll) even if not
		// currently in viewport.
		await expect(
			page
				.locator('.welcome-screen-2 button')
				.filter({ hasText: /pick your artists/i }),
		).toBeAttached({ timeout: 5000 })
	})

	test('Screen 2 sits at or below the fold on initial load', async ({ page }) => {
		await page.goto('http://localhost:9000/')

		// Hero is full-viewport (100svh). Screen 2 is attached but its top edge
		// sits at or beyond the fold; the explicit `↓` CTA carries the "more
		// below" affordance instead of a partial peek.
		const screen2 = page.locator('.welcome-screen-2')
		await expect(screen2).toBeAttached({ timeout: 10_000 })

		const viewport = page.viewportSize()
		const box = await screen2.boundingBox()
		expect(box).not.toBeNull()
		if (box && viewport) {
			expect(box.y).toBeGreaterThanOrEqual(viewport.height)
		}
	})

	test('Dashboard preview renders when concert data is available', async ({
		page,
	}) => {
		// mockRpcRoutes (via beforeEach) returns concerts for ConcertService/List.
		// loadPreviewConcerts iterates PREVIEW_ARTIST_IDS and stops after ≥3 artists
		// return concerts. The preview section only renders when previewDateGroups.length > 0.
		await page.goto('http://localhost:9000/')

		// Preview section is present in DOM (in scroll-snap Screen 2)
		const preview = page.locator('[data-testid="welcome-preview"]')
		await expect(preview).toBeAttached({ timeout: 10_000 })

		// Scroll to Screen 2 to make preview visible
		await preview.scrollIntoViewIfNeeded()

		// At least one event card rendered inside the preview
		const cards = preview.locator('event-card')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })
	})

	test('Dashboard preview is hidden when no concert data; hero CTAs fall back inline', async ({
		page,
	}) => {
		// Override the default mock to return empty concerts for all ConcertService/List calls.
		await page.route('**/liverty_music.rpc.**', (route) => {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		})

		await page.goto('http://localhost:9000/')

		// In the fallback state, [Pick your artists] renders inline on Screen 1 and is
		// visible in the initial viewport.
		await expect(
			page
				.locator('button')
				.filter({ hasText: /pick your artists/i })
				.first(),
		).toBeVisible({ timeout: 5000 })

		// Preview section is absent (if.bind="dateGroups.length > 0")
		await expect(
			page.locator('[data-testid="welcome-preview"]'),
		).not.toBeAttached()

		// Scroll-affordance button is also absent when there's no Screen 2 to scroll to
		await expect(page.locator('.welcome-scroll-cta')).not.toBeAttached()
	})

	// -------------------------------------------------------------------------
	// Discovery (soft gate — reachable any time)
	// -------------------------------------------------------------------------

	test('Discovery is reachable directly while onboarding (no forced redirect)', async ({
		page,
	}) => {
		await page.addInitScript(seedOnboarding)
		await page.goto('http://localhost:9000/discovery')

		// Soft gate: the discovery layout renders; the auth hook does not redirect.
		await page.waitForSelector('.discovery-layout', { timeout: 10_000 })
		await expect(page).toHaveURL(/discovery/)
	})

	test('No popover-guide snack on discovery page entry', async ({ page }) => {
		await page.addInitScript(seedOnboarding)
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout')

		await page.waitForLoadState('networkidle')
		await expect(page.locator('.snack-item')).toHaveCount(0)
	})

	test('No coach mark when ConcertService/List returns empty', async ({
		page,
	}) => {
		await page.unrouteAll()
		await mockRpcRoutesEmpty(page)
		await mockLastFmApi(page)

		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})

		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout')

		// Wait for all concert searches to complete, then verify no coach mark.
		// With zero concerts, artistsWithConcertsCount stays 0 and followedCount
		// (3) is below DASHBOARD_FOLLOW_TARGET (5), so the spotlight never shows.
		await page.waitForLoadState('networkidle')
		await expect(page.locator('.visual-spotlight')).not.toBeVisible({
			timeout: 3000,
		})
	})

	test('Coach-mark spotlight appears when 3 artists have concert data', async ({
		page,
	}) => {
		test.setTimeout(60_000)
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout')

		// Coach mark has NO auto-fade timer — it stays visible until target tap,
		// tap-outside, or route detach. Concert searches for the 3 seeded follows
		// complete fast against the mock, pushing artistsWithConcertsCount to
		// DASHBOARD_CONCERT_TARGET (3) and activating the spotlight.
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toBeVisible({ timeout: 30_000 })

		// Verify box-shadow (dark overlay) is applied
		const boxShadow = await spotlight.evaluate(
			(el) => getComputedStyle(el).boxShadow,
		)
		expect(boxShadow).not.toBe('none')

		// Tap-outside-to-dismiss: a pointer tap on the dimmed area (top-left,
		// away from the target which sits in the bottom nav) light-dismisses the
		// coach mark via the document pointerdown listener, without navigating.
		await page.mouse.click(5, 5)
		await expect(spotlight).toHaveCount(0)
		await expect(page).toHaveURL(/discovery/)
	})

	test('Reload with pre-seeded follows preserves followed count', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout')

		// SR status includes followed count
		const srOutput = page.locator('output.sr-only[role="status"]')
		await expect(srOutput).toContainText(/3/, { timeout: 10_000 })
	})

	// -------------------------------------------------------------------------
	// Dashboard (reachable any time; non-blocking overlays)
	// -------------------------------------------------------------------------

	test('Dashboard is reachable directly while onboarding (no forced redirect)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})
		await page.goto('http://localhost:9000/dashboard')

		await expect(page).toHaveURL(/dashboard/)
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })
	})

	test('Guest with zero follows sees the dashboard empty-state CTA (no redirect)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('guest.home', 'JP-13')
			// No guest.followedArtists → followedCount === 0 → showGuestEmptyState
		})
		await page.goto('http://localhost:9000/dashboard')

		// Soft gate: stays on the dashboard and surfaces the in-page empty-state
		// CTA toward discovery instead of a guard redirect. The CTA placeholder is
		// gated on `!isLoading` settling, so allow the initial load to complete.
		await expect(page).toHaveURL(/dashboard/)
		await expect(
			page.locator('state-placeholder').first(),
		).toBeVisible({ timeout: 15_000 })
	})

	test('Celebration does not replay after page reload', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		await expect(page.locator('.celebration-overlay')).toHaveCount(0)
	})

	test('Dashboard is interactive after reload (no stuck overlay)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })
		await expect(page.locator('.celebration-overlay')).toHaveCount(0)
	})

	test('Coach mark tooltip has transparent background (no colored box)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		const tooltip = page.locator('.coach-mark-tooltip')
		if ((await tooltip.count()) > 0) {
			const bg = await tooltip.evaluate(
				(el) => getComputedStyle(el).backgroundColor,
			)
			expect(bg).not.toMatch(/rgb\(255,\s*255,\s*255\)/)
		}
	})

	test('Toast popover has no white background gap', async ({ page }) => {
		await page.addInitScript(seedCompleted)
		await page.goto('http://localhost:9000/dashboard')

		await page.evaluate(() => {
			const popover = document.querySelector('[popover].toast-popover')
			if (popover) {
				const style = getComputedStyle(popover)
				if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
					throw new Error(
						`Toast popover has non-transparent background: ${style.backgroundColor}`,
					)
				}
			}
		})
	})

	// -------------------------------------------------------------------------
	// My Artists (hype fully decoupled from onboarding)
	// -------------------------------------------------------------------------

	test('My Artists page loads; hype change has no dialog and never touches onboarding', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('guest.home', 'JP-13')
			// Suppress the my-artists help sheet's first-visit auto-open so it
			// doesn't sit over the hype table (this test is about hype, not help).
			localStorage.setItem('liverty:onboarding:helpSeen:my-artists', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})
		await page.goto('http://localhost:9000/my-artists')
		await page.waitForSelector('my-artists-route', { timeout: 10_000 })

		// Hype dots are visible in the artist table
		await expect(page.locator('[data-artist-rows]')).toBeVisible({
			timeout: 5000,
		})

		// Trigger hype change by dispatching 'change' on the 'home' radio (index 1).
		// click({ force: true }) doesn't fire 'change' on visually-hidden inputs;
		// direct dispatchEvent is the reliable path for hidden form controls.
		const hypeRadios = page.locator('input[type="radio"][name^="hype-"]')
		await expect(hypeRadios.first()).toBeAttached({ timeout: 5000 })
		await page.evaluate(() => {
			const radio = document.querySelectorAll<HTMLInputElement>(
				'input[type="radio"][name^="hype-"]',
			)[1]
			if (!radio) throw new Error('hype radio not found')
			radio.dispatchEvent(new Event('change', { bubbles: true }))
		})

		// No hype-notification dialog (component was removed)
		await expect(page.locator('.hype-notification-dialog')).toHaveCount(0)

		// Hype change is fully decoupled from onboarding (#444): the flag must NOT
		// flip to completed as a side effect of a hype tap. It stays "still
		// onboarding" (false) — completion latches only on a meaningful dashboard
		// arrival or sign-up, never here.
		await expect
			.poll(
				() => page.evaluate(() => localStorage.getItem('onboardingComplete')),
				{ timeout: 3000 },
			)
			.toBe('false')
	})
})

/**
 * End-to-end soft-gate roam: a guest freely moves
 *   Discovery → Dashboard → My Artists
 * with NO step machine, NO forced redirects, NO blocking overlays, and NO
 * consent screen. Onboarding completion latches on the first MEANINGFUL
 * dashboard arrival (region set + data loaded + followedCount >= 1).
 */
test.describe('Soft-gate roam (Discovery → Dashboard → My Artists)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test('guest roams across tabs and onboarding latches on meaningful dashboard arrival', async ({
		page,
	}) => {
		test.setTimeout(90_000)

		await mockRpcRoutes(page)
		await mockLastFmApi(page)

		// Seed: still onboarding, 3 follows, home set (needed for ListWithProximity
		// on dashboard). celebrationShown suppresses the light celebration overlay
		// so it never intercepts nav-tab clicks (covered by dashboard unit tests).
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			// Suppress the discovery / my-artists help-sheet auto-open so it never
			// intercepts the nav-tab clicks this roam test performs (page-help is
			// covered by its own unit/visual tests).
			localStorage.setItem('liverty:onboarding:helpSeen:discovery', '1')
			localStorage.setItem('liverty:onboarding:helpSeen:dashboard', '1')
			localStorage.setItem('liverty:onboarding:helpSeen:my-artists', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})

		// -- DISCOVERY: reachable directly; non-blocking coach mark appears --------
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout')

		// Coach mark has no auto-fade — assert it becomes visible once concert
		// searches push artistsWithConcertsCount to the threshold.
		await page.waitForFunction(
			() => {
				const el = document.querySelector('.visual-spotlight')
				if (!el) return false
				const style = getComputedStyle(el)
				return style.visibility !== 'hidden' && style.display !== 'none'
			},
			{ timeout: 30_000 },
		)

		// Still onboarding while on discovery (no latch here).
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).toBe('false')

		// -- DASHBOARD: reachable via the coach-mark tap; meaningful arrival latches -
		// The coach mark anchors a clickable `.target-interceptor` over its target
		// ([data-nav="home"]). Tapping it delegates to the target's native click
		// (onTargetClick → currentTarget.click()), navigating to the dashboard and
		// dismissing the spotlight. The interceptor paints above the dismiss
		// backdrop, so a tap on the target navigates rather than dismissing.
		await page.locator('coach-mark .target-interceptor').click()
		await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })

		// Completion latch (B1): region set + data loaded + followedCount >= 1 →
		// finish() flips onboardingComplete to 'true', which persists to storage.
		await expect
			.poll(
				() => page.evaluate(() => localStorage.getItem('onboardingComplete')),
				{ timeout: 10_000 },
			)
			.toBe('true')

		// Coach mark dismissed on leaving discovery.
		await expect(page.locator('.visual-spotlight')).toHaveCount(0)

		// -- MY ARTISTS: reachable via SPA nav; hype change has no dialog ----------
		await page.locator('[data-nav="my-artists"]').click()
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })

		await expect(page.locator('[data-artist-rows]')).toBeVisible({
			timeout: 10_000,
		})
		await expect(page.locator('.artist-row').first()).toBeVisible({
			timeout: 5000,
		})

		// Dispatch 'change' on the 'home' radio (index 1) for the first artist.
		// Hype editing is fully decoupled: it applies with no dialog and never
		// reverts the (already-latched) onboarding flag.
		const hypeRadios = page.locator('input[type="radio"][name^="hype-"]')
		await expect(hypeRadios.first()).toBeAttached({ timeout: 5000 })
		await page.evaluate(() => {
			const radio = document.querySelectorAll<HTMLInputElement>(
				'input[type="radio"][name^="hype-"]',
			)[1]
			if (!radio) throw new Error('hype radio not found')
			radio.dispatchEvent(new Event('change', { bubbles: true }))
		})

		// No dialog, and onboarding stays completed (one-way latch, idempotent).
		await expect(page.locator('.hype-notification-dialog')).toHaveCount(0)
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).toBe('true')
	})
})
