import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	callsOf,
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	type RpcCall,
} from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

/**
 * A fan finds the concerts near their area in a period from Discovery —
 * including artists they do not follow — and follows an artist from one of
 * them, against a mocked backend (ConcertService.ListByLocation,
 * FollowService.Follow).
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
test.use({ viewport: { width: 390, height: 844 } })

const STORY = 'stories/find-concerts-nearby'

type Day = { year: number; month: number; day: number }

function dayFrom(d: Date): Day {
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** This weekend by the 今週末 rule: the coming Sat–Sun, or the rest of it. */
function thisWeekend(): { from: Day; to: Day } {
	const today = new Date()
	const dow = today.getDay()
	const sat = new Date(today)
	if (dow === 0) return { from: dayFrom(today), to: dayFrom(today) }
	sat.setDate(today.getDate() + (6 - dow))
	const sun = new Date(sat)
	sun.setDate(sat.getDate() + 1)
	return { from: dayFrom(sat), to: dayFrom(sun) }
}

const ARTISTS = {
	fukuoka: { id: fakeId('artist-fukuoka'), name: 'HAKATA BAND' },
	kumamoto: { id: fakeId('artist-kumamoto'), name: 'KUMAMOTO BAND' },
	tokyo: { id: fakeId('artist-tokyo'), name: 'TOKYO BAND' },
}

function concert(
	key: keyof typeof ARTISTS,
	day: Day,
	venue: string,
	area: string,
) {
	const artist = ARTISTS[key]
	return {
		id: { value: fakeId(`concert-${key}`) },
		performers: [
			{
				id: { value: artist.id },
				name: { value: artist.name },
				mbid: { value: '' },
			},
		],
		series: {
			id: { value: fakeId(`series-${key}`) },
			title: { value: `${artist.name} LIVE` },
		},
		localDate: { value: day },
		venue: { name: { value: venue }, adminArea: { value: area } },
		sourceUrl: { value: 'https://example.com' },
	}
}

/**
 * ListByLocation for a weekend around Fukuoka. The server puts the Kumamoto
 * concert (within 200 km) under NEAR; the Tokyo one is never in its answer
 * for this area, but an AWAY entry is returned here too to show the view
 * would not list it even if it were.
 */
function nearbyAnswer(from: Day) {
	return concertWire({
		groups: [
			{
				date: { value: from },
				home: [concert('fukuoka', from, 'Zepp Fukuoka', 'JP-40')],
				nearby: [concert('kumamoto', from, '熊本 B.9 V1', 'JP-43')],
				away: [concert('tokyo', from, 'Zepp Haneda', 'JP-13')],
			},
		],
	})
}

interface Seed {
	signedIn?: boolean
	home?: string | null
}

async function openApp(page: Page, seed: Seed = {}): Promise<RpcCall[]> {
	const { from } = thisWeekend()
	let followed = false
	await page.addInitScript(
		({ home, signedIn, sub, email }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem('language', 'ja')
			if (home) localStorage.setItem('guest.home', home)
			if (signedIn) {
				localStorage.setItem(
					'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
					JSON.stringify({
						id_token: 'fake-id-token',
						access_token: 'fake-access-token',
						token_type: 'Bearer',
						scope: 'openid profile email',
						profile: { sub, email },
						expires_at: 9999999999,
					}),
				)
			}
		},
		{
			home: seed.home === undefined ? 'JP-40' : seed.home,
			signedIn: !!seed.signedIn,
			sub: FAN_SUB,
			email: FAN_EMAIL,
		},
	)
	const kumamoto = {
		artist: {
			id: { value: ARTISTS.kumamoto.id },
			name: { value: ARTISTS.kumamoto.name },
			mbid: { value: '' },
		},
		hype: 3, // NEARBY: the backend's level for a follow from a nearby concert
	}
	const calls = await mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: FAN_SUB },
				email: { value: FAN_EMAIL },
				home: { countryCode: 'JP', level1: 'JP-40' },
			},
		},
		'ConcertService/ListByLocation': nearbyAnswer(from),
		'FollowService/Follow': () => {
			followed = true
			return { body: {} }
		},
		'FollowService/List': () => ({
			body: { artists: followed ? [kumamoto] : [] },
		}),
		// The followed artist's concerts, for the dashboard timetable.
		'ConcertService/ListFollowed': () => ({
			body: followed
				? concertWire({
						groups: [
							{
								date: { value: from },
								home: [],
								nearby: [concert('kumamoto', from, '熊本 B.9 V1', 'JP-43')],
								away: [],
							},
						],
					})
				: {},
		}),
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	return calls
}

const view = (page: Page) => page.locator('nearby-concerts')
const cardOf = (page: Page, name: string) =>
	view(page).locator('[data-live-card]', { hasText: name })

/** Open Discovery and switch to the All Nearby view with the swap tile. */
async function openNearby(page: Page): Promise<void> {
	await page.goto('/discovery')
	await page.getByTestId('discovery-swap').click()
	await expect(view(page)).toBeVisible({ timeout: 30_000 })
}

test(`@spec ${STORY} "A weekend near home"`, async ({ page }) => {
	const calls = await openApp(page)
	await openNearby(page)

	await view(page).getByTestId('nearby-date-chip').click()
	await page.getByRole('button', { name: '今週末' }).click()
	await expect(view(page).getByTestId('nearby-date-chip')).toContainText(
		'今週末',
	)

	// Asked for this weekend around the fan's home area.
	const weekend = thisWeekend()
	await expect
		.poll(() =>
			callsOf(calls, 'ConcertService/ListByLocation').map((c) => c.body),
		)
		.toContainEqual(
			expect.objectContaining({
				location: expect.objectContaining({ adminArea: 'JP-40' }),
				from: { value: weekend.from },
				to: { value: weekend.to },
			}),
		)

	// @spec components/infrastructure/fan/web/route/discovery "HOME and NEARBY lanes rendered"
	// @spec components/infrastructure/fan/web/route/discovery "Venue name shown for all lanes"
	const home = cardOf(page, ARTISTS.fukuoka.name)
	const near = cardOf(page, ARTISTS.kumamoto.name)
	await expect(home).toBeVisible({ timeout: 15_000 })
	await expect(near).toBeVisible()
	await expect(home).toContainText('Zepp Fukuoka')
	await expect(near).toContainText('熊本 B.9 V1')
	// HOME on the left lane, NEAR on the right.
	const h = await home.boundingBox()
	const n = await near.boundingBox()
	expect(h && n && h.x < n.x).toBe(true)
	// Neither artist is followed; Tokyo is not listed.
	await expect(cardOf(page, ARTISTS.tokyo.name)).toHaveCount(0)
	await expect(view(page).locator('[data-hide-away="true"]')).toHaveCount(1)
})

test(`@spec ${STORY} "No home area yet"`, async ({ page }) => {
	const calls = await openApp(page, { home: null })
	await page.goto('/discovery?view=nearby')
	await expect(view(page)).toBeVisible({ timeout: 30_000 })

	// The area selector asks first; nothing is listed before an area is chosen.
	await expect(view(page).getByTestId('nearby-area-chip')).toContainText(
		'エリアを選ぶ',
	)
	await expect(
		view(page)
			.locator(
				'user-home-selector dialog[open], user-home-selector :popover-open',
			)
			.first(),
	).toBeVisible()
	expect(callsOf(calls, 'ConcertService/ListByLocation')).toEqual([])
	await expect(view(page).locator('[data-live-card]')).toHaveCount(0)
})

test(`@spec ${STORY} "Signed-in fan follows from a nearby concert"`, async ({
	page,
}) => {
	const calls = await openApp(page, { signedIn: true })
	await openNearby(page)

	await cardOf(page, ARTISTS.kumamoto.name).click({ timeout: 15_000 })
	const follow = page.getByRole('button', {
		name: 'このアーティストをフォロー',
	})
	await follow.click()
	await expect(page.getByTestId('all-nearby-following')).toBeVisible()
	expect(callsOf(calls, 'FollowService/Follow').map((c) => c.body)).toEqual([
		{ artistId: { value: ARTISTS.kumamoto.id } },
	])

	// In My Artists at hype level Nearby…
	await page.keyboard.press('Escape')
	await page.goto('/my-artists')
	const row = page.locator('.artist-row', { hasText: ARTISTS.kumamoto.name })
	await expect(row).toBeVisible({ timeout: 30_000 })
	await expect(row.locator('.hype-dot[data-active="true"]')).toHaveAttribute(
		'data-level',
		'nearby',
	)

	// …and its concerts on the dashboard timetable.
	await page.goto('/dashboard')
	await expect(
		page.locator('dashboard-route [data-live-card]', {
			hasText: ARTISTS.kumamoto.name,
		}),
	).toBeVisible({ timeout: 30_000 })
})

test(`@spec ${STORY} "Guest taps follow"`, async ({ page }) => {
	const calls = await openApp(page)
	await openNearby(page)

	await cardOf(page, ARTISTS.kumamoto.name).click({ timeout: 15_000 })
	await page.getByRole('button', { name: 'このアーティストをフォロー' }).click()

	const banner = page.locator('.signup-banner')
	await expect(banner).toBeVisible()
	// Docked on the navigation bar across the full width, as on every other
	// screen — not anchored to Discovery's layout box.
	const b = await page.locator('signup-prompt-banner').boundingBox()
	const nav = await page.locator('bottom-nav-bar nav').boundingBox()
	expect(b && nav && Math.abs(b.y + b.height - nav.y)).toBeLessThanOrEqual(1)
	expect(b?.x).toBe(0)
	expect(b?.width).toBe(390)
	expect(callsOf(calls, 'FollowService/Follow')).toEqual([])
	expect(
		await page.evaluate(() => localStorage.getItem('guest.followedArtists')),
	).toBeNull()
})

test(`@spec components/infrastructure/fan/web/route/dashboard "Guest with no follows"`, async ({
	page,
}) => {
	await openApp(page)
	await page.goto('/dashboard')
	const link = page.getByTestId('nearby-link')
	await expect(link).toHaveText('近くのライブを見る', { timeout: 30_000 })
	await expect(page.getByTestId('discover-link')).toBeVisible()

	await link.click()
	await expect(page).toHaveURL(/\/discovery\?view=nearby$/)
	await expect(view(page)).toBeVisible()
})
