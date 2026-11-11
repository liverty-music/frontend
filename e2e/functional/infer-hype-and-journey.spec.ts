import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { callsOf, FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })

/**
 * What the app infers from a signed-in fan's own actions on the Dashboard's
 * event detail sheet: a calendar add starts tracking the concert (with undo
 * when the fan comes back), and a journey for a concert the fan's hype level
 * does not match raises the level (with undo). The backend is a stateful mock
 * that applies the server's rules (TicketJourneyService.InferTracking stores
 * Tracking only without a journey; SetStatus raises a level the fan did not
 * set), so the app's side of each story runs end to end.
 */

const TRACK = 'stories/track-ticket-journey'
const HYPE = 'stories/set-hype-for-an-artist'

const ARTIST = { id: fakeId('infer-artist'), name: 'ヨルシカ' }
const HOME_CONCERT = fakeId('infer-home-concert')
const AWAY_CONCERT = fakeId('infer-away-concert')
const AWAY_CONCERT_2 = fakeId('infer-away-concert-2')

type Hype = 'HYPE_TYPE_HOME' | 'HYPE_TYPE_NEARBY' | 'HYPE_TYPE_AWAY'
type SetBy = 'default' | 'fan' | 'inference'

const RANK: Record<Hype, number> = {
	HYPE_TYPE_HOME: 1,
	HYPE_TYPE_NEARBY: 2,
	HYPE_TYPE_AWAY: 3,
}

interface Server {
	hype: Hype
	hypeSetBy: SetBy
	journeys: Map<string, string>
}

function inDays(days: number) {
	const d = new Date()
	d.setDate(d.getDate() + days)
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

function concert(id: string, title: string, area: string, days: number) {
	return {
		id: { value: id },
		performers: [
			{
				id: { value: ARTIST.id },
				name: { value: ARTIST.name },
				mbid: { value: '' },
			},
		],
		series: { id: { value: fakeId(`series-${id}`) }, title: { value: title } },
		localDate: { value: inDays(days) },
		venue: { name: { value: `${title} Hall` }, adminArea: { value: area } },
		sourceUrl: { value: 'https://example.com/live' },
	}
}

/** The away concerts are in JP-40 (Fukuoka); the fan's home is JP-13. */
const AWAY_LANE: Record<string, number> = {
	[AWAY_CONCERT]: 2,
	[AWAY_CONCERT_2]: 3,
}

/**
 * Waits for the hype re-read that follows a journey change, then for two frames
 * (the raise snack would show right after it), instead of sleeping.
 */
async function expectNoSnackAfterReRead(
	page: Page,
	calls: Parameters<typeof callsOf>[0],
	rereadsBefore: number,
): Promise<void> {
	await expect
		.poll(() => callsOf(calls, 'FollowService/List').length)
		.toBeGreaterThan(rereadsBefore)
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
}

/** Mock the backend with the server's rules, starting from `server`. */
async function mockBackend(page: Page, server: Server) {
	const groups = [
		{
			date: { value: inDays(1) },
			home: [concert(HOME_CONCERT, 'Home Show', 'JP-13', 1)],
			nearby: [],
			away: [],
		},
		...Object.entries(AWAY_LANE).map(([id, days]) => ({
			date: { value: inDays(days) },
			home: [],
			nearby: [],
			away: [concert(id, `Away Show ${days}`, 'JP-40', days)],
		})),
	]
	const raiseFor = (eventId: string) => {
		// The lowest level that matches an away-lane concert is Away.
		const target: Hype =
			eventId in AWAY_LANE ? 'HYPE_TYPE_AWAY' : 'HYPE_TYPE_HOME'
		if (server.hypeSetBy !== 'fan' && RANK[target] > RANK[server.hype]) {
			server.hype = target
			server.hypeSetBy = 'inference'
		}
	}
	return mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: FAN_SUB },
				email: { value: FAN_EMAIL },
				preferredLanguage: 'ja',
				home: { countryCode: 'JP', level1: 'JP-13' },
			},
		},
		'FollowService/List': () => ({
			body: {
				artists: [
					{
						artist: { id: { value: ARTIST.id }, name: { value: ARTIST.name } },
						hype: server.hype,
					},
				],
			},
		}),
		'FollowService/SetHype': (body) => {
			server.hype = body.hype as Hype
			server.hypeSetBy = 'fan'
			return { body: {} }
		},
		'ConcertService/ListFollowed': concertWire({ groups }),
		'TicketJourneyService/List': () => ({
			body: {
				journeys: [...server.journeys].map(([eventId, status]) => ({
					userId: { value: FAN_SUB },
					eventId: { value: eventId },
					status,
				})),
			},
		}),
		'TicketJourneyService/InferTracking': (body) => {
			const eventId = (body.eventId as { value: string }).value
			if (server.journeys.has(eventId)) return { body: { started: false } }
			server.journeys.set(eventId, 'TICKET_JOURNEY_STATUS_TRACKING')
			return { body: { started: true } }
		},
		'TicketJourneyService/SetStatus': (body) => {
			const eventId = (body.eventId as { value: string }).value
			const status = body.status as string
			server.journeys.set(eventId, status)
			if (
				[
					'TICKET_JOURNEY_STATUS_APPLIED',
					'TICKET_JOURNEY_STATUS_UNPAID',
					'TICKET_JOURNEY_STATUS_PAID',
				].includes(status)
			) {
				raiseFor(eventId)
			}
			return { body: {} }
		},
		'TicketJourneyService/Delete': (body) => {
			server.journeys.delete((body.eventId as { value: string }).value)
			return { body: {} }
		},
	})
}

async function seedSignedIn(page: Page) {
	await page.context().addInitScript(
		({ sub, email }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('onboarding.helpSeen:dashboard', '1')
			localStorage.setItem('onboarding.helpSeen:my-artists', '1')
			localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem('ui.notificationPromptDismissed', 'true')
			localStorage.setItem('language', 'ja')
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
		},
		{ sub: FAN_SUB, email: FAN_EMAIL },
	)
	// The calendar opens in a new tab; answer it with an empty page.
	await page
		.context()
		.route('https://calendar.google.com/**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<p>calendar</p>' }),
		)
}

const sheet = (page: Page) => page.locator('event-detail-sheet')
const snack = (page: Page, text: string) =>
	page.locator('snack-bar .snack-item', { hasText: text })

/** Open the detail sheet of the concert with this venue name. */
async function openSheet(page: Page, venue: string) {
	await page.locator('[data-live-card]').first().waitFor({ timeout: 30_000 })
	// The cards deal in with a transform; a click while one is still moving
	// can miss it, so let every deal-in finish first.
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => (a as CSSAnimation).animationName === 'deal-in')
				.map((a) => a.finished),
		),
	)
	await page
		.locator('[data-live-card]')
		.filter({ hasText: ARTIST.name })
		.nth(VENUE_ORDER.indexOf(venue))
		.click()
	await expect(sheet(page).getByText(venue).first()).toBeVisible()
}

/** Cards in date order: the home concert, then the two away concerts. */
const VENUE_ORDER = ['Home Show Hall', 'Away Show 2 Hall', 'Away Show 3 Hall']

function cardOf(page: Page, venue: string) {
	return page
		.locator('[data-live-card]')
		.filter({ hasText: ARTIST.name })
		.nth(VENUE_ORDER.indexOf(venue))
}

async function closeSheet(page: Page) {
	await page.keyboard.press('Escape')
	await expect(page).toHaveURL(/\/dashboard/)
}

test.describe('calendar add starts tracking', () => {
	// The sale notice for a Tracking journey is the backend's (design.md
	// @spec-manual for this story scenario); this test covers the app's part.
	test('a calendar add records Tracking, shows the snack on return and undoes it', async ({
		page,
	}) => {
		const server: Server = {
			hype: 'HYPE_TYPE_NEARBY',
			hypeSetBy: 'default',
			journeys: new Map(),
		}
		await seedSignedIn(page)
		const calls = await mockBackend(page, server)
		await page.goto('/dashboard')

		await openSheet(page, 'Home Show Hall')
		const tab = page.context().waitForEvent('page')
		await sheet(page).getByRole('link', { name: 'カレンダーに追加' }).click()
		const calendar = await tab
		// The journey is saved at the click, before the fan comes back.
		await expect
			.poll(() => callsOf(calls, 'TicketJourneyService/InferTracking').length)
			.toBe(1)
		expect(server.journeys.get(HOME_CONCERT)).toBe(
			'TICKET_JOURNEY_STATUS_TRACKING',
		)

		// The fan comes back to the app.
		await calendar.close()
		await page.bringToFront()
		const tracking = snack(page, '🔔 チケット販売の通知を受け取ります')
		await expect(tracking).toBeVisible()
		// The sheet and the Dashboard card show Tracking.
		await expect(sheet(page).getByTestId('journey-notify-btn')).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await expect(
			cardOf(page, 'Home Show Hall').getByTestId('journey-badge'),
		).toHaveAttribute('data-journey-status', 'tracking')

		// 取り消す removes the journey on every screen.
		await tracking.getByRole('button', { name: '取り消す' }).click()
		await expect
			.poll(() => callsOf(calls, 'TicketJourneyService/Delete').length)
			.toBe(1)
		await expect(sheet(page).getByTestId('journey-notify-btn')).toHaveAttribute(
			'aria-pressed',
			'false',
		)
		await expect(
			cardOf(page, 'Home Show Hall').getByTestId('journey-badge'),
		).toHaveCount(0)
		expect(server.journeys.has(HOME_CONCERT)).toBe(false)
	})

	test(`@spec ${TRACK} "Opening a new-concert push changes no journey"`, async ({
		page,
	}) => {
		const server: Server = {
			hype: 'HYPE_TYPE_NEARBY',
			hypeSetBy: 'default',
			journeys: new Map(),
		}
		await seedSignedIn(page)
		const calls = await mockBackend(page, server)

		// A new-concert push opens the Dashboard on the concert's detail sheet.
		await page.goto(`/concerts/${HOME_CONCERT}`)
		await expect(sheet(page).getByText('Home Show Hall').first()).toBeVisible({
			timeout: 30_000,
		})

		expect(
			calls.filter((c) => /TicketJourneyService\/(?!List)/.test(c.method)),
		).toEqual([])
		expect(server.journeys.size).toBe(0)
	})
})

test.describe('a journey for a distant concert raises the hype level', () => {
	test(`@spec ${TRACK} "Applied for a distant concert"`, async ({ page }) => {
		const server: Server = {
			hype: 'HYPE_TYPE_NEARBY',
			hypeSetBy: 'default',
			journeys: new Map(),
		}
		await seedSignedIn(page)
		await mockBackend(page, server)
		await page.goto('/dashboard')

		const away = cardOf(page, 'Away Show 2 Hall')
		await away.waitFor({ timeout: 30_000 })
		await expect(away).not.toHaveAttribute('data-matched', /.*/)

		await openSheet(page, 'Away Show 2 Hall')
		await sheet(page)
			.locator('.journey-row [data-journey-status="applied"]')
			.click()

		const raised = snack(page, `${ARTIST.name}の全ての新着ライブを`)
		await expect(raised).toBeVisible()
		await closeSheet(page)
		// The Dashboard highlights the away concert at the new level.
		await expect(cardOf(page, 'Away Show 2 Hall')).toHaveAttribute(
			'data-matched',
			'true',
		)

		// My Artists shows the new level.
		await page.goto('/my-artists')
		const row = page.locator('.artist-row', { hasText: ARTIST.name })
		await expect(row.locator('.hype-dot[data-active="true"]')).toHaveAttribute(
			'data-level',
			'away',
			{ timeout: 30_000 },
		)
	})

	test(`@spec ${HYPE} "Undone raise stays"`, async ({ page }) => {
		const server: Server = {
			hype: 'HYPE_TYPE_NEARBY',
			hypeSetBy: 'default',
			journeys: new Map(),
		}
		await seedSignedIn(page)
		const calls = await mockBackend(page, server)
		await page.goto('/dashboard')

		await openSheet(page, 'Away Show 2 Hall')
		await sheet(page)
			.locator('.journey-row [data-journey-status="applied"]')
			.click()
		const raised = snack(page, `${ARTIST.name}の全ての新着ライブを`)
		await raised.getByRole('button', { name: '取り消す' }).click()

		// The previous level is saved as the fan's own choice.
		await expect
			.poll(() =>
				callsOf(calls, 'FollowService/SetHype').map((c) => c.body.hype),
			)
			.toEqual(['HYPE_TYPE_NEARBY'])
		await closeSheet(page)
		await expect(cardOf(page, 'Away Show 2 Hall')).not.toHaveAttribute(
			'data-matched',
			/.*/,
		)

		// A later Applied for another distant concert leaves it at Nearby.
		await openSheet(page, 'Away Show 3 Hall')
		const rereadsBefore = callsOf(calls, 'FollowService/List').length
		await sheet(page)
			.locator('.journey-row [data-journey-status="applied"]')
			.click()
		await expect(
			sheet(page).locator('.journey-row [data-journey-status="applied"]'),
		).toHaveAttribute('aria-pressed', 'true')
		// An absence check: the raise snack would follow the hype re-read at once.
		await expectNoSnackAfterReRead(page, calls, rereadsBefore)
		await expect(snack(page, '新着ライブを')).toHaveCount(0)
		expect(server.hype).toBe('HYPE_TYPE_NEARBY')
	})

	test(`@spec ${HYPE} "Picked level survives a distant journey"`, async ({
		page,
	}) => {
		// The fan picked Home on My Artists.
		const server: Server = {
			hype: 'HYPE_TYPE_HOME',
			hypeSetBy: 'fan',
			journeys: new Map(),
		}
		await seedSignedIn(page)
		const calls = await mockBackend(page, server)
		await page.goto('/dashboard')

		await openSheet(page, 'Away Show 2 Hall')
		const rereadsBefore = callsOf(calls, 'FollowService/List').length
		await sheet(page)
			.locator('.journey-row [data-journey-status="applied"]')
			.click()
		await sheet(page)
			.locator('.journey-row [data-journey-status="unpaid"]')
			.click()
		await sheet(page)
			.locator('.journey-row [data-journey-status="paid"]')
			.click()
		await expect(
			sheet(page).locator('.journey-row [data-journey-status="paid"]'),
		).toHaveAttribute('aria-pressed', 'true')
		// An absence check: the raise snack would follow the hype re-read at once.
		await expectNoSnackAfterReRead(page, calls, rereadsBefore)
		await expect(snack(page, '新着ライブを')).toHaveCount(0)

		await page.goto('/my-artists')
		const row = page.locator('.artist-row', { hasText: ARTIST.name })
		await expect(row.locator('.hype-dot[data-active="true"]')).toHaveAttribute(
			'data-level',
			'home',
			{ timeout: 30_000 },
		)
	})
})
