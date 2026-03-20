import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for artist image UI integration.
 *
 * Verifies:
 * - 5.1: Event cards show logo image for artists with fanart, text for others
 * - 5.2: Detail sheet shows hero image when backgroundUrl exists
 * - 5.3: Grid tiles show thumbnail background when available, gradient when not
 *
 * Uses completed onboarding + fake OIDC auth so the RPC path is exercised
 * (onboarding path returns store data without fanart URLs).
 */

// Use data: URLs to bypass CSP (img-src 'self' data: blob:).
// 1x1 transparent PNGs with distinct colors for test identification.
const FANART_LOGO_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
const FANART_BG_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=='
const FANART_THUMB_URL =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const OIDC_AUTHORITY = 'https://dev-svijfm.us1.zitadel.cloud'
const OIDC_CLIENT_ID = '358723495233859681'

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

/** ListFollowed response with mixed fanart data:
 *  - artist-1 (YOASOBI): has all fanart images
 *  - artist-2 (Vaundy): has no fanart
 *  - artist-3 (Ado): has only music_logo (no hd_music_logo)
 */
function listFollowedResponse() {
	return {
		artists: [
			{
				artist: {
					id: { value: 'artist-1' },
					name: { value: 'YOASOBI' },
					mbid: { value: 'mbid-1' },
					fanart: {
						hdMusicLogo: { value: FANART_LOGO_URL },
						artistBackground: { value: FANART_BG_URL },
						artistThumb: { value: FANART_THUMB_URL },
					},
				},
				hype: 4, // AWAY
			},
			{
				artist: {
					id: { value: 'artist-2' },
					name: { value: 'Vaundy' },
					mbid: { value: 'mbid-2' },
				},
				hype: 2, // HOME
			},
			{
				artist: {
					id: { value: 'artist-3' },
					name: { value: 'Ado' },
					mbid: { value: 'mbid-3' },
					fanart: {
						musicLogo: { value: FANART_LOGO_URL },
					},
				},
				hype: 3, // NEARBY
			},
		],
	}
}

/** ListByFollower response with ProximityGroups for non-onboarding mode. */
function listByFollowerResponse() {
	return {
		groups: [
			{
				date: {
					value: {
						year: tomorrow.getFullYear(),
						month: tomorrow.getMonth() + 1,
						day: tomorrow.getDate(),
					},
				},
				home: [
					{
						id: { value: 'c-2' },
						artistId: { value: 'artist-2' },
						title: { value: 'Vaundy Tour 2026' },
						localDate: {
							value: {
								year: tomorrow.getFullYear(),
								month: tomorrow.getMonth() + 1,
								day: tomorrow.getDate(),
							},
						},
						startTime: {
							value: new Date(
								tomorrow.getFullYear(),
								tomorrow.getMonth(),
								tomorrow.getDate(),
								18,
								0,
							).toISOString(),
						},
						venue: {
							name: { value: 'Budokan' },
							adminArea: { value: 'JP-13' },
						},
						sourceUrl: { value: 'https://example.com/vaundy' },
					},
				],
				nearby: [],
				away: [
					{
						id: { value: 'c-1' },
						artistId: { value: 'artist-1' },
						title: { value: 'YOASOBI Live 2026' },
						localDate: {
							value: {
								year: tomorrow.getFullYear(),
								month: tomorrow.getMonth() + 1,
								day: tomorrow.getDate(),
							},
						},
						startTime: {
							value: new Date(
								tomorrow.getFullYear(),
								tomorrow.getMonth(),
								tomorrow.getDate(),
								19,
								0,
							).toISOString(),
						},
						venue: {
							name: { value: 'Zepp DiverCity' },
							adminArea: { value: 'JP-13' },
						},
						sourceUrl: {
							value: 'https://example.com/yoasobi',
						},
					},
				],
			},
		],
	}
}

/** Mock all RPC routes with fanart-enriched data. */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		// UserService/Get: return a user with home area to skip region dialog
		if (url.includes('UserService/Get')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					user: {
						id: { value: 'test-user-123' },
						email: { value: 'test@example.com' },
						home: {
							countryCode: 'JP',
							level1: 'JP-13',
						},
					},
				}),
			})
		}

		if (url.includes('ListByFollower')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(listByFollowerResponse()),
			})
		}

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(listFollowedResponse()),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/** Mock Last.fm API to prevent real network calls. */
async function mockLastFmApi(page: Page): Promise<void> {
	await page.route('**/ws.audioscrobbler.com/**', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/** Mock OIDC discovery endpoint to prevent real calls. */
async function mockOidcDiscovery(page: Page): Promise<void> {
	await page.route(
		`${OIDC_AUTHORITY}/.well-known/openid-configuration`,
		(route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					issuer: OIDC_AUTHORITY,
					authorization_endpoint: `${OIDC_AUTHORITY}/oauth/v2/authorize`,
					token_endpoint: `${OIDC_AUTHORITY}/oauth/v2/token`,
					userinfo_endpoint: `${OIDC_AUTHORITY}/oidc/v1/userinfo`,
					end_session_endpoint: `${OIDC_AUTHORITY}/oidc/v1/end_session`,
					jwks_uri: `${OIDC_AUTHORITY}/oauth/v2/keys`,
				}),
			})
		},
	)
}

/**
 * Seed completed onboarding state with a fake OIDC user so the app uses
 * the RPC code path (which returns fanart URLs from the mocked ListFollowed).
 *
 * NOTE: This function must be fully self-contained (no closures) because
 * Playwright serializes it via .toString() for addInitScript.
 */
function seedAuthenticatedState() {
	return () => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('ui.notificationPromptDismissed', 'true')

		// Fake OIDC user stored by oidc-client-ts WebStorageStateStore
		// Key format: {prefix}user:{authority}:{client_id} (default prefix: "oidc.")
		const oidcKey =
			'oidc.user:https://dev-svijfm.us1.zitadel.cloud:358723495233859681'
		localStorage.setItem(
			oidcKey,
			JSON.stringify({
				id_token: 'fake-id-token',
				access_token: 'fake-access-token',
				token_type: 'Bearer',
				scope: 'openid profile email',
				profile: {
					sub: 'test-user-123',
					preferred_username: 'test@example.com',
					name: 'Test User',
				},
				expires_at: 9999999999,
			}),
		)
	}
}

// ---------------------------------------------------------------------------
// 5.1: Event Card Logo Display
// ---------------------------------------------------------------------------

test.describe('Event card logo display', () => {
	test.beforeEach(async ({ page }) => {
		await mockRpcRoutes(page)
		await mockLastFmApi(page)
		await mockOidcDiscovery(page)
		await page.addInitScript(seedAuthenticatedState())
	})

	test('5.1a: artist with fanart shows logo image instead of text', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		// Wait for event cards to render
		const cards = page.locator('[data-live-card]')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })

		// Find the card for YOASOBI (has hdMusicLogo)
		const yoasobiCard = cards
			.filter({ has: page.locator('img.artist-logo') })
			.first()
		await expect(yoasobiCard).toBeVisible({ timeout: 5_000 })

		// Verify the logo image has the correct src
		const logoImg = yoasobiCard.locator('img.artist-logo')
		await expect(logoImg).toHaveAttribute('src', FANART_LOGO_URL)
		await expect(logoImg).toHaveAttribute('loading', 'lazy')
		await expect(logoImg).toHaveAttribute('decoding', 'async')

		// The text span should NOT be visible for this card
		const textName = yoasobiCard.locator('.artist-name')
		await expect(textName).toHaveCount(0)
	})

	test('5.1b: artist without fanart shows text name', async ({ page }) => {
		await page.goto('http://localhost:9000/dashboard')

		const cards = page.locator('[data-live-card]')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })

		// Find a card with text name (Vaundy has no fanart)
		const textCards = cards.filter({ has: page.locator('.artist-name') })
		await expect(textCards.first()).toBeVisible({ timeout: 5_000 })

		// The text name should display
		const vanudyText = textCards.first().locator('.artist-name')
		await expect(vanudyText).toBeVisible()

		// No logo image for this card
		const logoImg = textCards.first().locator('img.artist-logo')
		await expect(logoImg).toHaveCount(0)
	})
})

// ---------------------------------------------------------------------------
// 5.2: Detail Sheet Hero Image
// ---------------------------------------------------------------------------

test.describe('Event detail sheet hero image', () => {
	test.beforeEach(async ({ page }) => {
		await mockRpcRoutes(page)
		await mockLastFmApi(page)
		await mockOidcDiscovery(page)
		await page.addInitScript(seedAuthenticatedState())
	})

	test('5.2a: detail sheet shows hero image when backgroundUrl exists', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		// Wait for cards and click the one with fanart (YOASOBI)
		const cards = page.locator('[data-live-card]')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })

		// Click a card with logo (YOASOBI) to open detail sheet
		const yoasobiCard = cards
			.filter({ has: page.locator('img.artist-logo') })
			.first()
		await yoasobiCard.click()

		// Detail sheet should open with hero image
		const heroImg = page.locator('.sheet-hero-img')
		await expect(heroImg).toBeVisible({ timeout: 5_000 })
		await expect(heroImg).toHaveAttribute('src', FANART_BG_URL)

		// Hero container should exist
		const heroSection = page.locator('.sheet-hero')
		await expect(heroSection).toBeVisible()
	})

	test('5.2b: detail sheet has no hero image when backgroundUrl absent', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		const cards = page.locator('[data-live-card]')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })

		// Click a card without fanart (Vaundy)
		const textCards = cards.filter({ has: page.locator('.artist-name') })
		await textCards.first().click()

		// Detail sheet should open without hero section
		const sheetContent = page.locator('.sheet-content')
		await expect(sheetContent).toBeVisible({ timeout: 5_000 })

		const heroSection = page.locator('.sheet-hero')
		await expect(heroSection).toHaveCount(0)
	})
})
