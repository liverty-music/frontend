import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { expect, type Page, test } from '../support/test'

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
 *   `onboardingComplete === 'true'`.
 * - The only coach mark is the Welcome demo's own: 5 s after the demo timetable
 *   becomes interactive it highlights the first concert card, and a tap on that
 *   card through the spotlight does what a direct tap does (opens the sheet).
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

/**
 * Mock Connect-RPC with concert data.
 * - ConcertService/List: returns 1 concert per artist (drives
 *   artistsWithConcertsCount on Discovery)
 * - ListByArtists: returns concerts in the away lane
 * - FollowService/List: returns 3 followed artists
 */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('ListByArtists')) {
			// Return concerts for 6 preview artists to satisfy
			// PREVIEW_MIN_ARTISTS_WITH_CONCERTS (=5). Performer IDs MUST
			// match `config.json` `previewArtistIds` — otherwise
			// concert-service's `toDateGroups` performer-resolution loop
			// won't find them in the artistMap (built from preview UUIDs),
			// produces `resolved=0`, drops the group, leaves `dateGroups`
			// empty, and the welcome page falls back to the inline-CTA
			// path (no see-preview button).
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
				body: JSON.stringify(
					concertWire({
						groups: artists.map((aid, i) => ({
							date: { value: { year: 2026, month: 6, day: 15 + i } },
							home: [],
							nearby: [],
							away: [
								{
									id: { value: fakeId(`c-${aid}`) },
									performers: [
										{
											id: { value: aid },
											name: { value: `Artist ${i + 1}` },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: fakeId(`s-${aid}`) },
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
				),
			})
		}

		if (url.includes('ConcertService/ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						groups: [
							{
								date: { value: { year: 2026, month: 6, day: 15 } },
								away: [
									{
										id: { value: '00000000-0000-4000-8000-c10000000001' },
										performers: [
											{
												id: { value: '00000000-0000-4000-8000-a10000000001' },
												name: { value: 'Test Artist' },
												mbid: { value: '' },
											},
										],
										series: {
											id: { value: '00000000-0000-4000-8000-5e0000000001' },
											title: { value: 'Test Concert' },
										},
										localDate: { value: { year: 2026, month: 6, day: 15 } },
									},
								],
							},
						],
					}),
				),
			})
		}

		// ConcertService/List — returns 1 concert per artist.
		// Makes concertService.artistsWithConcertsCount >= 3, which (while
		// onboarding) fills the Discovery progress row to ready.
		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						concerts: [
							{
								id: { value: '00000000-0000-4000-8000-c10000000001' },
								performers: [
									{
										id: { value: '00000000-0000-4000-8000-a10000000001' },
										name: { value: 'Test Artist' },
										mbid: { value: '' },
									},
								],
								series: {
									id: { value: '00000000-0000-4000-8000-5e0000000001' },
									title: { value: 'Test Concert' },
								},
								localDate: { value: { year: 2026, month: 6, day: 15 } },
							},
						],
					}),
				),
			})
		}

		if (url.includes('FollowService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{
							id: { value: '00000000-0000-4000-8000-a10000000001' },
							name: { value: 'Artist 1' },
							hype: 'watch',
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000002' },
							name: { value: 'Artist 2' },
							hype: 'watch',
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000003' },
							name: { value: 'Artist 3' },
							hype: 'watch',
						},
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
							mbid: fakeId(`mbid-${i + 1}`),
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

	// Advance the guided demo (notification → interactive timetable) by tapping
	// the mock push notification. Motion is enabled by default in CI, so the
	// notification phase renders before the timetable.
	async function advanceDemoToTimetable(
		page: import('@playwright/test').Page,
	): Promise<void> {
		await page.locator('[data-testid="welcome-demo"]').scrollIntoViewIfNeeded()
		const notification = page.locator('.welcome-notification-trigger')
		await expect(notification).toBeVisible({ timeout: 10_000 })
		await notification.click()
		await expect(page.locator('[data-testid="welcome-timetable"]')).toBeVisible(
			{
				timeout: 6000,
			},
		)
	}

	test('Welcome hero shows the scroll affordance; the guided demo opens on the notification', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')

		// Screen 1 shows the scroll-affordance (message-first), not a commit CTA.
		await expect(page.getByTestId('welcome-see-preview')).toBeVisible({
			timeout: 10_000,
		})
		await expect(
			page
				.locator('.welcome-hero button')
				.filter({ hasText: /pick your artists/i }),
		).toHaveCount(0)

		// The guided demo is attached below the hero and opens on the notification.
		await expect(page.locator('[data-testid="welcome-demo"]')).toBeAttached({
			timeout: 10_000,
		})
		await expect(
			page.locator('[data-testid="welcome-demo-notification"]'),
		).toBeAttached()
	})

	test('Scroll affordance reveals the demo; advancing exposes Pick your artists → Discovery', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')

		// Tap the scroll affordance to reveal the guided demo below the hero.
		await page.getByTestId('welcome-see-preview').click()
		await advanceDemoToTimetable(page)

		// The timetable's primary CTA is visible and navigates to Discovery.
		const getStarted = page
			.locator('[data-testid="welcome-timetable"] button')
			.filter({ hasText: /pick your artists/i })
		await expect(getStarted).toBeVisible({ timeout: 5000 })
		await getStarted.click()
		await expect(page).toHaveURL(/discovery/, { timeout: 10_000 })
	})

	test('Completed: welcome still exposes the primary CTA in the guided demo', async ({
		page,
	}) => {
		await page.addInitScript(seedCompleted)
		await page.goto('http://localhost:9000/')

		await advanceDemoToTimetable(page)

		await expect(
			page
				.locator('[data-testid="welcome-timetable"] button')
				.filter({ hasText: /pick your artists/i }),
		).toBeAttached({ timeout: 5000 })
	})

	test('The guided demo sits at or below the fold on initial load', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')

		// Hero is full-viewport (100svh); the demo section's top sits at or beyond
		// the fold — the explicit `↓` scroll CTA carries the "more below" affordance.
		const demo = page.locator('[data-testid="welcome-demo"]')
		await expect(demo).toBeAttached({ timeout: 10_000 })

		const viewport = page.viewportSize()
		const box = await demo.boundingBox()
		expect(box).not.toBeNull()
		if (box && viewport) {
			expect(box.y).toBeGreaterThanOrEqual(viewport.height)
		}
	})

	test('Timetable preview renders when concert data is available', async ({
		page,
	}) => {
		// mockRpcRoutes (via beforeEach) returns concerts, so the guided demo renders;
		// the timetable preview lives in the demo's interactive second phase.
		await page.goto('http://localhost:9000/')

		await advanceDemoToTimetable(page)

		// The preview is present and renders at least one event card.
		const preview = page.locator('[data-testid="welcome-preview"]')
		await expect(preview).toBeAttached({ timeout: 10_000 })
		const cards = preview.locator('event-card')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Target tap performs the target's own action"
	test('Welcome coach mark: tapping the highlighted card opens its detail sheet and closes the coach mark', async ({
		page,
	}) => {
		test.setTimeout(45_000)
		await page.goto('http://localhost:9000/')
		await advanceDemoToTimetable(page)

		// 5 s after the timetable is interactive, the spotlight lands on the
		// first concert card.
		const firstCard = page
			.locator('[data-testid="welcome-timetable"] [data-live-card]')
			.first()
		await expect(firstCard).toBeVisible({ timeout: 15_000 })
		const spotlight = page.locator('coach-mark .visual-spotlight')
		await expect(spotlight).toBeVisible({ timeout: 10_000 })
		await expect(firstCard).toHaveCSS('anchor-name', '--coach-target')
		const sheet = page.locator('event-detail-sheet bottom-sheet')
		await expect(sheet).not.toBeVisible()

		// A real tap at the card's centre lands on the coach mark's interceptor…
		await firstCard.scrollIntoViewIfNeeded()
		const box = await firstCard.boundingBox()
		expect(box).not.toBeNull()
		if (!box) return
		const x = box.x + box.width / 2
		const y = box.y + box.height / 2
		expect(
			await page.evaluate(
				([px, py]) =>
					document
						.elementFromPoint(px, py)
						?.classList.contains('target-interceptor') ?? false,
				[x, y],
			),
		).toBe(true)
		await page.mouse.click(x, y)

		// …and does what a direct tap on the card does: its detail sheet opens.
		await expect(sheet).toBeVisible({ timeout: 5000 })
		// The coach mark has closed.
		await expect(page.locator('coach-mark .coach-mark-overlay')).toHaveCount(0)
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
		await expect(page.getByTestId('welcome-see-preview')).not.toBeAttached()
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

	test('Reload with pre-seeded follows preserves followed count', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'Artist 1',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Artist 2',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000003',
							name: 'Artist 3',
						},
						home: null,
					},
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
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'Artist 1',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Artist 2',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000003',
							name: 'Artist 3',
						},
						home: null,
					},
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
		await expect(page.locator('state-placeholder').first()).toBeVisible({
			timeout: 15_000,
		})
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
			localStorage.setItem('onboarding.helpSeen:my-artists', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'Artist 1',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Artist 2',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000003',
							name: 'Artist 3',
						},
						home: null,
					},
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

		// Seed: still onboarding, 3 follows, home set (needed for ListByArtists
		// on dashboard). celebrationShown suppresses the light celebration overlay
		// so it never intercepts nav-tab clicks (covered by dashboard unit tests).
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			// Suppress the discovery / my-artists help-sheet auto-open so it never
			// intercepts the nav-tab clicks this roam test performs (page-help is
			// covered by its own unit/visual tests).
			localStorage.setItem('onboarding.helpSeen:discovery', '1')
			localStorage.setItem('onboarding.helpSeen:dashboard', '1')
			localStorage.setItem('onboarding.helpSeen:my-artists', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000001',
							name: 'Artist 1',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000002',
							name: 'Artist 2',
						},
						home: null,
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a10000000003',
							name: 'Artist 3',
						},
						home: null,
					},
				]),
			)
		})

		// -- DISCOVERY: reachable directly; the progress row becomes ready -------
		await page.goto('http://localhost:9000/discovery')
		await page.waitForSelector('.discovery-layout')

		// The lookups for the 3 restored follows each find a concert, which
		// fills the progress row and turns it into the link to the Dashboard.
		const ready = page.locator('onboarding-progress').getByRole('link')
		await expect(ready).toBeVisible({ timeout: 30_000 })
		// No spotlight on the bottom navigation.
		await expect(page.locator('coach-mark')).toHaveCount(0)

		// Still onboarding while on discovery (no latch here).
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).toBe('false')

		// -- DASHBOARD: the ready row opens it; meaningful arrival latches --------
		await ready.click()
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
