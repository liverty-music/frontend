import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	callsOf,
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	type RpcCall,
} from '../support/fan-auth'
import { openConcertsFilters } from '../support/fan-shell'
import { flowShot } from '../support/flow-shot'
import { expect, type Page, test } from '../support/test'

/**
 * A signed-in fan finds the concerts near their area in a period from
 * Discovery — including artists they do not follow — and follows an artist
 * from one of them, against a mocked backend (ConcertService.ListByLocation,
 * FollowService.Follow). A guest is offered no Concerts view.
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
// The service worker would take over the page a moment after it loads and
// send the RPCs past the mocks below, to the real backend: a step taken a
// few seconds in (a follow) then fails. Block it, as virtual-ticket does.
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })

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
	/** Signed in unless false: the Concerts view is a signed-in fan's. */
	signedIn?: boolean
	/** The home area: the account's for a fan, the device's for a guest. */
	home?: string | null
	/** A guest's follows on the device. */
	guestFollows?: (keyof typeof ARTISTS)[]
	/** A signed-in fan who already follows the Tokyo artist. */
	followsTokyo?: boolean
}

async function openApp(page: Page, seed: Seed = {}): Promise<RpcCall[]> {
	const { from } = thisWeekend()
	let followed = false
	const signedIn = seed.signedIn ?? true
	const home = seed.home === undefined ? 'JP-40' : seed.home
	await page.addInitScript(
		({ home, signedIn, sub, email, guestFollows }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem('language', 'ja')
			if (home && !signedIn) localStorage.setItem('guest.home', home)
			if (guestFollows.length > 0) {
				localStorage.setItem(
					'guest.followedArtists',
					JSON.stringify(
						guestFollows.map((artist) => ({ artist, hype: 'nearby' })),
					),
				)
			}
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
			home,
			signedIn,
			sub: FAN_SUB,
			email: FAN_EMAIL,
			guestFollows: (seed.guestFollows ?? []).map((k) => ({
				...ARTISTS[k],
				mbid: '',
			})),
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
				...(home && { home: { countryCode: 'JP', level1: home } }),
			},
		},
		// The bubbles of Discovery.
		'ArtistService/ListTop': {
			artists: Array.from({ length: 20 }, (_, i) => ({
				id: { value: fakeId(`top-${i}`) },
				name: { value: `Artist ${i}` },
				mbid: { value: '' },
			})),
		},
		// A guest's follows' concerts, for the guest timetable.
		'ConcertService/ListByArtists': concertWire({
			groups: [
				{
					date: { value: from },
					home: [concert('fukuoka', from, 'Zepp Fukuoka', 'JP-40')],
					nearby: [],
					away: [],
				},
			],
		}),
		'ConcertService/ListByLocation': nearbyAnswer(from),
		'FollowService/Follow': () => {
			followed = true
			return { body: {} }
		},
		'FollowService/List': () => ({
			body: {
				artists: [
					...(seed.followsTokyo
						? [
								{
									artist: {
										id: { value: ARTISTS.tokyo.id },
										name: { value: ARTISTS.tokyo.name },
										mbid: { value: '' },
									},
									hype: 3,
								},
							]
						: []),
					...(followed ? [kumamoto] : []),
				],
			},
		}),
		// The followed artist's concerts, for the timetable.
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

const view = (page: Page) => page.locator('discovery-concerts')
const cardOf = (page: Page, name: string) =>
	view(page).locator('[data-live-card]', { hasText: name })

/** Open Discovery and switch to the Concerts view with the swap tile. */
async function openNearby(page: Page): Promise<void> {
	await page.goto('/discovery')
	await page.getByTestId('discovery-swap').click()
	await expect(view(page)).toBeVisible({ timeout: 30_000 })
}

test(`@spec ${STORY} "A weekend near home"`, {
	tag: '@flow',
}, async ({ page }) => {
	// A fan who follows an artist: the swap tile's moment is theirs.
	const calls = await openApp(page, { followsTokyo: true })
	await page.goto('/discovery')
	const line = page.locator('guide-line .guide-line')
	await expect(line).toContainText('すぐに行けるライブも見てみよう！', {
		timeout: 30_000,
	})
	await flowShot(page, 'Discovery: the swap tile guide moment')
	await page.getByTestId('discovery-swap').click()
	await expect(view(page)).toBeVisible({ timeout: 30_000 })
	await expect(line).toContainText('遠征するときはココを変更！')
	await flowShot(page, 'The Concerts view: the filter guide moment')

	const rows = await openConcertsFilters(page)
	await flowShot(page, 'The filter sheet')
	await rows.period.click()
	await page.getByRole('button', { name: '今週末' }).click()

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
	await flowShot(page, 'This weekend near Fukuoka')
	await expect(view(page).locator('[data-hide-away="true"]')).toHaveCount(1)
})

test(`@spec ${STORY} "No home area yet"`, async ({ page }) => {
	const calls = await openApp(page, { home: null })
	await page.goto('/discovery?view=concerts')
	await expect(view(page)).toBeVisible({ timeout: 30_000 })

	// The area selector asks first; nothing is listed before an area is chosen.
	await expect(
		view(page)
			.locator(
				'home-area-selector dialog[open], home-area-selector :popover-open',
			)
			.first(),
	).toBeVisible()
	expect(callsOf(calls, 'ConcertService/ListByLocation')).toEqual([])
	await expect(view(page).locator('[data-live-card]')).toHaveCount(0)
})

test(`@spec ${STORY} "Signed-in fan follows from a nearby concert"`, {
	tag: '@flow',
}, async ({ page }) => {
	const calls = await openApp(page, { signedIn: true })
	await openNearby(page)

	await cardOf(page, ARTISTS.kumamoto.name).click({ timeout: 15_000 })
	// 「Follow」 on the right of the artist name, at the top of the sheet.
	const follow = page.getByRole('button', { name: 'Follow', exact: true })
	await expect(follow).toBeVisible()
	await flowShot(page, 'A nearby concert: Follow beside the artist name')
	await follow.click()
	await expect(page.getByTestId('discovery-concerts-following')).toBeVisible()
	await flowShot(page, 'Following')
	// 「Following」 shows at once (an optimistic update); the request follows.
	await expect
		.poll(() => callsOf(calls, 'FollowService/Follow').map((c) => c.body))
		.toEqual([{ artistId: { value: ARTISTS.kumamoto.id } }])

	// In My Artists at hype level Nearby…
	await page.keyboard.press('Escape')
	await page.goto('/my-artists')
	const row = page.locator('.artist-row', { hasText: ARTISTS.kumamoto.name })
	await expect(row).toBeVisible({ timeout: 30_000 })
	await expect(row.locator('.hype-dot[data-active="true"]')).toHaveAttribute(
		'data-level',
		'nearby',
	)
	await flowShot(page, 'My Artists: the new artist at Nearby')

	// …and its concerts on the timetable.
	await page.goto('/timetable')
	await expect(
		page.locator('timetable-route [data-live-card]', {
			hasText: ARTISTS.kumamoto.name,
		}),
	).toBeVisible({ timeout: 30_000 })
	await flowShot(page, 'The Timetable: its concert')
})

test(`@spec ${STORY} "A guest"`, { tag: '@flow' }, async ({ page }) => {
	const calls = await openApp(page, { signedIn: false })
	await page.goto('/discovery?view=concerts')

	// The artist bubbles, no swap tile, and the address without the view.
	await expect(page.locator('artist-bubbles')).toBeVisible({ timeout: 30_000 })
	await expect(page).toHaveURL(/\/discovery$/)
	await expect(page.getByTestId('discovery-swap')).toHaveCount(0)
	await expect(view(page)).toHaveCount(0)
	expect(callsOf(calls, 'ConcertService/ListByLocation')).toEqual([])
	await expect(page.locator('guide-line .guide-line')).toContainText(
		'気になるアーティストをタップしてフォローしよう！',
		{ timeout: 30_000 },
	)
	await flowShot(page, 'A guest on Discovery: bubbles, no swap tile')
})

test(`@spec ${STORY} "Guest taps follow"`, async ({ page }) => {
	const calls = await openApp(page, {
		signedIn: false,
		guestFollows: ['fukuoka'],
	})
	await page.goto('/timetable')
	await page
		.locator('timetable-route [data-live-card]', {
			hasText: ARTISTS.fukuoka.name,
		})
		.click({ timeout: 30_000 })
	await expect(
		page.locator('concert-sheet').getByText('Zepp Fukuoka').first(),
	).toBeVisible()

	// No follow action in a guest's sheet.
	await expect(
		page.getByRole('button', { name: 'Follow', exact: true }),
	).toHaveCount(0)
	await expect(page.getByTestId('discovery-concerts-follow')).toHaveCount(0)
	expect(callsOf(calls, 'FollowService/Follow')).toEqual([])
})

test(`@spec components/infrastructure/fan/web/route/timetable "Guest with no follows"`, async ({
	page,
}) => {
	await openApp(page, { signedIn: false })
	await page.goto('/timetable')
	await expect(page.getByTestId('discover-link')).toBeVisible({
		timeout: 30_000,
	})
	await expect(page.getByTestId('concerts-link')).toHaveCount(0)
})

test(`@spec components/infrastructure/fan/web/route/timetable "Signed-in fan with no follows"`, async ({
	page,
}) => {
	await openApp(page)
	await page.goto('/timetable')
	const link = page.getByTestId('concerts-link')
	await expect(link).toHaveText('ライブを探す', { timeout: 30_000 })
	await expect(page.getByTestId('discover-link')).toBeVisible()

	await link.click()
	await expect(page).toHaveURL(/\/discovery\?view=concerts$/)
	await expect(view(page)).toBeVisible()
})
