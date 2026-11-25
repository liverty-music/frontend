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

/**
 * A date `offset` days after a month from now, in the shape of the wire's
 * `LocalDate`. The guest timetable hides dates before today, so a mocked
 * concert needs a date that stays ahead of the day the test runs.
 */
function upcomingDate(offset: number): {
	year: number
	month: number
	day: number
} {
	const d = new Date()
	d.setDate(d.getDate() + 30 + offset)
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

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
							date: { value: upcomingDate(i) },
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
									localDate: { value: upcomingDate(i) },
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
		await page.goto('/')

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
		await page.goto('/')

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
		await page.goto('/')

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
		await page.goto('/')

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

	// @spec components/infrastructure/fan/web/route/welcome "Timetable shown as a composed frame"
	test('Timetable preview renders when concert data is available', async ({
		page,
	}) => {
		// mockRpcRoutes (via beforeEach) returns concerts, so the guided demo renders;
		// the timetable preview lives in the demo's interactive second phase.
		await page.goto('/')

		// The demo says where the timetable comes from before showing it:
		// following artists is enough, and a new concert arrives as a notification.
		await page.locator('[data-testid="welcome-demo"]').scrollIntoViewIfNeeded()
		await expect(page.locator('.welcome-demo-lead')).toBeVisible({
			timeout: 10_000,
		})

		await advanceDemoToTimetable(page)

		// The preview is present and renders at least one event card.
		const preview = page.locator('[data-testid="welcome-preview"]')
		await expect(preview).toBeAttached({ timeout: 10_000 })
		const cards = preview.locator('concert-card')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })

		// It is captioned as the visitor's own timetable, and shown whole: the
		// preview is not cropped sideways and lies inside the viewport's width.
		await expect(
			page.locator(
				'[data-testid="welcome-timetable"] .welcome-section-tagline',
			),
		).toBeVisible()
		const frame = await preview.evaluate((el) => ({
			cropped: el.scrollWidth > el.clientWidth + 1,
			left: el.getBoundingClientRect().left,
			right: el.getBoundingClientRect().right,
			viewport: window.innerWidth,
		}))
		expect(frame.cropped).toBe(false)
		expect(frame.left).toBeGreaterThanOrEqual(0)
		expect(frame.right).toBeLessThanOrEqual(frame.viewport)
	})

	// @spec components/infrastructure/fan/web/global/coach-mark "Target tap performs the target's own action"
	// @spec components/infrastructure/fan/web/route/welcome "Guidance to open a concert"
	test('Welcome coach mark: tapping the highlighted card opens its detail sheet and closes the coach mark', async ({
		page,
	}) => {
		test.setTimeout(45_000)
		await page.goto('/')
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
		const sheet = page.locator('concert-sheet bottom-sheet')
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
		await expect(
			page.locator('coach-mark .coach-mark-overlay'),
		).not.toBeVisible()
	})

	// @spec components/infrastructure/fan/web/route/welcome "Timetable absent without preview data"
	test('Timetable preview is hidden when no concert data; hero CTAs fall back inline', async ({
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

		await page.goto('/')

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
		await page.goto('/discovery')

		// Soft gate: the discovery layout renders; the auth hook does not redirect.
		await expect(page.locator('.discovery-layout')).toBeVisible({
			timeout: 10_000,
		})
		await expect(page).toHaveURL(/discovery/)
	})

	test('No popover-guide snack on discovery page entry', async ({ page }) => {
		await page.addInitScript(seedOnboarding)
		await page.goto('/discovery')
		await expect(page.locator('.discovery-layout')).toBeVisible({
			timeout: 10_000,
		})

		// biome-ignore lint/suspicious/noPlaywrightNetworkidle: an absence check; the snack would follow a data load, so every load must finish first
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
		await page.goto('/discovery')
		await expect(page.locator('.discovery-layout')).toBeVisible({
			timeout: 10_000,
		})

		// SR status includes followed count
		const srOutput = page.locator('output.visually-hidden[role="status"]')
		await expect(srOutput).toContainText(/3/, { timeout: 10_000 })
	})

	// -------------------------------------------------------------------------
	// Timetable (reachable any time; non-blocking overlays)
	// -------------------------------------------------------------------------

	test('Timetable is reachable directly while onboarding (no forced redirect)', async ({
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
		await page.goto('/timetable')

		await expect(page).toHaveURL(/timetable/)
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })
	})

	// @spec stories/complete-onboarding "No latch for a zero-follow timetable arrival"
	test('Guest with zero follows sees the timetable empty-state CTA (no redirect)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('guest.home', 'JP-13')
			// No guest.followedArtists → followedCount === 0 → showGuestEmptyState
		})
		await page.goto('/timetable')

		// Soft gate: stays on the timetable and surfaces the in-page empty-state
		// CTA toward discovery instead of a guard redirect. The CTA placeholder is
		// gated on `!isLoading` settling, so allow the initial load to complete.
		await expect(page).toHaveURL(/timetable/)
		await expect(page.locator('state-placeholder').first()).toBeVisible({
			timeout: 15_000,
		})
		// The guest stays in onboarding: Discovery's progress row still applies,
		// and Discovery's help does not open on its own.
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).toBe('false')
		await page.getByTestId('discover-link').click()
		await expect(page.locator('onboarding-progress')).toBeVisible({
			timeout: 30_000,
		})
		await expect(page.locator('page-help .sheet-body')).toBeHidden()
	})

	// @spec stories/complete-onboarding "Completion latches after choosing the home area on arrival"
	test('Guest choosing the home area on arrival sees the celebration with the counts and completes onboarding', async ({
		page,
	}) => {
		// Three follows (preview artists, which the ListByArtists mock returns
		// concerts for) and no home area: the Timetable asks for one first.
		await page.addInitScript(() => {
			localStorage.setItem('onboarding.helpSeen:timetable', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify(
					[
						'019c8655-7a05-71ef-82b4-a4ac2494e29f',
						'019c8655-7a05-721d-b0a8-4c11724d5c90',
						'019c8655-7a05-71e9-9af5-e1cd4fbfd367',
					].map((id, i) => ({
						artist: { id, name: `Artist ${i + 1}` },
						home: null,
					})),
				),
			)
		})
		await page.goto('/timetable')

		await page.getByRole('button', { name: 'Tokyo' }).first().click()

		// The timetable for Tokyo, not the one built before the choice (which
		// had no concert), decides the celebration.
		const overlay = page.locator('.celebration-overlay[data-state="active"]')
		await expect(overlay).toBeVisible({ timeout: 10_000 })
		await expect(overlay).toContainText(/Found [1-9]\d* shows by 3 artists/)
		await expect
			.poll(() =>
				page.evaluate(() => localStorage.getItem('onboardingComplete')),
			)
			.toBe('true')
	})

	// @spec components/infrastructure/fan/web/global/celebration-overlay "Celebration plays after the home-area sheet closes"
	test('The celebration opens only once the home-area sheet has closed', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboarding.helpSeen:timetable', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify(
					[
						'019c8655-7a05-71ef-82b4-a4ac2494e29f',
						'019c8655-7a05-721d-b0a8-4c11724d5c90',
						'019c8655-7a05-71e9-9af5-e1cd4fbfd367',
					].map((id, i) => ({
						artist: { id, name: `Artist ${i + 1}` },
						home: null,
					})),
				),
			)
		})
		await page.goto('/timetable')
		const tokyo = page.getByRole('button', { name: 'Tokyo' }).first()
		await expect(tokyo).toBeVisible({ timeout: 30_000 })

		// Look at every frame from the choice on: the celebration must never be
		// active while the sheet is still on screen (it would play under it and
		// be over when the sheet is gone).
		await page.evaluate(() => {
			const seen = { sheetOpen: 0, overlayActive: 0, both: 0, frames: 0 }
			;(window as unknown as { __seen: typeof seen }).__seen = seen
			const tick = () => {
				const sheet = document.querySelector('home-area-selector [popover]')
				const open = sheet?.matches(':popover-open') ?? false
				const active =
					document
						.querySelector('.celebration-overlay')
						?.getAttribute('data-state') === 'active'
				seen.frames++
				if (open) seen.sheetOpen++
				if (active) seen.overlayActive++
				if (open && active) seen.both++
				requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		})
		await tokyo.click()

		await expect(
			page.locator('.celebration-overlay[data-state="active"]'),
		).toBeVisible({ timeout: 10_000 })
		const seen = await page.evaluate(
			() =>
				(
					window as unknown as {
						__seen: { sheetOpen: number; overlayActive: number; both: number }
					}
				).__seen,
		)
		// The check can fail: the sheet was on screen for frames, and the
		// overlay for frames after, and no frame had both.
		expect(seen.sheetOpen).toBeGreaterThan(0)
		expect(seen.overlayActive).toBeGreaterThan(0)
		expect(seen.both).toBe(0)
	})

	test('Celebration does not replay after page reload', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('/timetable')

		// The overlay element is always in the DOM; `data-state` says whether it
		// is showing. Waiting for the element also makes sure the timetable has
		// rendered, so the check cannot pass before the page exists.
		await expect(page.locator('.celebration-overlay')).toHaveAttribute(
			'data-state',
			'hidden',
		)
	})

	test('Timetable is interactive after reload (no stuck overlay)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('/timetable')

		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })
		// The overlay element is always in the DOM; `data-state` says whether it
		// is showing. Waiting for the element also makes sure the timetable has
		// rendered, so the check cannot pass before the page exists.
		await expect(page.locator('.celebration-overlay')).toHaveAttribute(
			'data-state',
			'hidden',
		)
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
		await page.goto('/my-artists')
		await expect(page.locator('my-artists-route')).toBeVisible({
			timeout: 10_000,
		})

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
		// onboarding" (false) — completion latches only on a meaningful timetable
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
 *   Discovery → Timetable → My Artists
 * with NO step machine, NO forced redirects, NO blocking overlays, and NO
 * consent screen. Onboarding completion latches on the first MEANINGFUL
 * timetable arrival (region set + data loaded + followedCount >= 1).
 */
test.describe('Soft-gate roam (Discovery → Timetable → My Artists)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test('guest roams across tabs and onboarding latches on meaningful timetable arrival', async ({
		page,
	}) => {
		test.setTimeout(90_000)

		await mockRpcRoutes(page)
		await mockLastFmApi(page)

		// Seed: still onboarding, 3 follows, home set (needed for ListByArtists
		// on timetable). celebrationShown suppresses the light celebration overlay
		// so it never intercepts nav-tab clicks (covered by timetable unit tests).
		await page.addInitScript(() => {
			localStorage.setItem('onboardingComplete', 'false')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			// Suppress the discovery / my-artists help-sheet auto-open so it never
			// intercepts the nav-tab clicks this roam test performs (page-help is
			// covered by its own unit/visual tests).
			localStorage.setItem('onboarding.helpSeen:discovery', '1')
			localStorage.setItem('onboarding.helpSeen:timetable', '1')
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
		await page.goto('/discovery')
		await expect(page.locator('.discovery-layout')).toBeVisible({
			timeout: 30_000,
		})

		// The lookups for the 3 restored follows each find a concert, which
		// fills the progress row and turns it into the link to the Timetable.
		const ready = page.locator('onboarding-progress').getByRole('link')
		await expect(ready).toBeVisible({ timeout: 30_000 })
		// No spotlight on the bottom navigation.
		await expect(page.locator('coach-mark')).toHaveCount(0)

		// Still onboarding while on discovery (no latch here).
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).toBe('false')

		// -- TIMETABLE: the ready row opens it; meaningful arrival latches --------
		await ready.click()
		await expect(page).toHaveURL(/timetable/, { timeout: 10_000 })
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
