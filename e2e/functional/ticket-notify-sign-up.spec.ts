import { OIDC_AUTHORITY } from '../support/auth-mocks'
import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	callsOf,
	connectError,
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	mockIdentityProvider,
	type RpcCall,
	seedSignedIn,
} from '../support/fan-auth'
import { flowShot } from '../support/flow-shot'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
test.use({ locale: 'ja-JP' })

/**
 * A guest's event detail sheet offers only the ticket sale notification
 * button, which asks in a dialog whether to sign up; the request survives
 * sign-up and tracks the event once the account exists. The backend and the
 * identity provider are mocked; journeys are kept by a stateful mock of
 * TicketJourneyService.
 */

const TRACK = 'stories/track-ticket-journey'
const USER_ID = '00000000-0000-4000-8000-c00000000003'
const ARTIST = { id: fakeId('notify-artist'), name: 'ヨルシカ', mbid: '' }
const EVENT_ID = fakeId('notify-concert')
const TRACKING = 'TICKET_JOURNEY_STATUS_TRACKING'

function inDays(days: number) {
	const d = new Date()
	d.setDate(d.getDate() + days)
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

const CONCERT = {
	id: { value: EVENT_ID },
	performers: [
		{
			id: { value: ARTIST.id },
			name: { value: ARTIST.name },
			mbid: { value: '' },
		},
	],
	series: { id: { value: fakeId('notify-series') }, title: { value: 'Tour' } },
	localDate: { value: inDays(20) },
	venue: { name: { value: 'Zepp Haneda' }, adminArea: { value: 'JP-13' } },
	sourceUrl: { value: 'https://example.com/live' },
}

const GROUPS = [
	{ date: { value: inDays(20) }, home: [CONCERT], nearby: [], away: [] },
]

const USER = {
	id: { value: USER_ID },
	email: { value: FAN_EMAIL },
	preferredLanguage: 'ja',
	home: { countryCode: 'JP', level1: 'JP-13' },
}

/** Seed a guest who finished onboarding and follows ヨルシカ, once per test. */
async function seedGuest(page: Page): Promise<void> {
	await page.context().addInitScript((artist) => {
		if (localStorage.getItem('__e2e_seeded')) return
		localStorage.setItem('__e2e_seeded', '1')
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('onboarding.helpSeen:timetable', '1')
		localStorage.setItem('pwa.installed', 'true')
		localStorage.setItem('language', 'ja')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([{ artist, hype: 'nearby' }]),
		)
	}, ARTIST)
}

/**
 * The backend: a guest lists concerts by artists; the account does not exist
 * until Create; journeys are kept in `journeys`.
 */
async function mockBackend(
	page: Page,
	journeys: Map<string, string>,
): Promise<RpcCall[]> {
	const calls: RpcCall[] = await mockFanRpc(page, {
		'ConcertService/ListByArtists': concertWire({ groups: GROUPS }),
		'ConcertService/ListFollowed': concertWire({ groups: GROUPS }),
		'UserService/Get': () =>
			callsOf(calls, 'UserService/Create').length > 0
				? { body: { user: USER } }
				: connectError('not_found', 404),
		'UserService/Create': { user: USER },
		'FollowService/List': {
			artists: [
				{
					artist: { id: { value: ARTIST.id }, name: { value: ARTIST.name } },
					hype: 'HYPE_TYPE_NEARBY',
				},
			],
		},
		'TicketJourneyService/List': () => ({
			body: {
				journeys: [...journeys].map(([eventId, status]) => ({
					userId: { value: USER_ID },
					eventId: { value: eventId },
					status,
				})),
			},
		}),
		'TicketJourneyService/SetStatus': (body) => {
			journeys.set(
				(body.eventId as { value: string }).value,
				body.status as string,
			)
			return { body: {} }
		},
	})
	return calls
}

const sheet = (page: Page) => page.locator('concert-sheet')
const notifyButton = (page: Page) =>
	sheet(page).getByTestId('journey-notify-btn')
const card = (page: Page) =>
	page.locator('[data-live-card]').filter({ hasText: ARTIST.name })
const signUpDialog = (page: Page) =>
	page.getByRole('dialog', { name: 'おっと、まだアカウントを持っていないね？' })
const celebration = (page: Page) =>
	page.locator('.celebration-overlay[data-state="active"]')
const TRACK_STEP_TITLE = 'あとはプッシュ通知をオンにするだけ！'

/** The browser has not been asked for notifications yet. */
async function undecidedNotifications(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(Notification, 'permission', {
			configurable: true,
			get: () => 'default',
		})
	})
}

/** A guest presses the notification button and chooses `choice` in the dialog. */
async function pressNotifyAndChoose(
	page: Page,
	choice: 'Sign Up' | 'あとで',
	shot?: string,
): Promise<void> {
	await notifyButton(page).click()
	const dialog = signUpDialog(page)
	await expect(dialog).toBeVisible()
	await expect(dialog).toContainText(
		'通知に必要なアカウントは無料ですぐに作成できるよ！',
	)
	if (shot) await flowShot(page, shot)
	await dialog.getByRole('button', { name: choice, exact: true }).click()
}

async function openSheet(page: Page): Promise<void> {
	await card(page).first().click({ timeout: 30_000 })
	await expect(sheet(page).getByText('Zepp Haneda').first()).toBeVisible()
}

test.describe('guests see no statuses', () => {
	test(`@spec ${TRACK} "A guest opens the Timetable"`, async ({ page }) => {
		await seedGuest(page)
		const calls = await mockBackend(page, new Map())
		await page.goto('/timetable')

		await expect(card(page).first()).toBeVisible({ timeout: 30_000 })
		await expect(card(page).getByTestId('journey-badge')).toHaveCount(0)
		expect(callsOf(calls, 'TicketJourneyService/List')).toHaveLength(0)
	})

	test(`@spec ${TRACK} "A guest opens a concert"`, async ({ page }) => {
		await seedGuest(page)
		await mockBackend(page, new Map())
		await page.goto('/timetable')

		await openSheet(page)

		await expect(notifyButton(page)).toHaveText(
			'🔔 チケット販売の通知を受け取る',
		)
		await expect(sheet(page).locator('.journey-row')).toHaveCount(0)
		await expect(sheet(page).locator('button[aria-pressed]')).toHaveCount(1)
	})

	test(`@spec ${TRACK} "Signing out clears the statuses"`, async ({ page }) => {
		await page.context().addInitScript(
			({ sub, email }) => {
				if (localStorage.getItem('__e2e_seeded')) return
				localStorage.setItem('__e2e_seeded', '1')
				localStorage.setItem('onboardingComplete', 'true')
				localStorage.setItem('onboarding.celebrationShown', '1')
				localStorage.setItem('onboarding.helpSeen:timetable', '1')
				localStorage.setItem('pwa.installed', 'true')
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
		const calls = await mockBackend(page, new Map([[EVENT_ID, TRACKING]]))
		// The fan's account exists from the start.
		await page.route('**/liverty_music.rpc.v1.UserService/Get', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ user: USER }),
			}),
		)
		await page.route(`${OIDC_AUTHORITY}/oidc/v1/end_session**`, (route) => {
			const url = new URL(route.request().url())
			return route.fulfill({
				status: 302,
				headers: {
					location: url.searchParams.get('post_logout_redirect_uri') ?? '/',
				},
			})
		})
		await page.goto('/timetable')
		await expect(card(page).getByTestId('journey-badge')).toHaveAttribute(
			'data-journey-status',
			'tracking',
			{ timeout: 30_000 },
		)

		await page.goto('/settings')
		await page.getByRole('button', { name: 'サインアウト' }).click()
		await page
			.getByRole('alertdialog', { name: 'サインアウトしますか？' })
			.getByRole('button', { name: 'サインアウト' })
			.click()
		await page.waitForURL((url) => url.pathname === '/welcome')

		// The next visitor in the same browser: a guest following the artist.
		await page.evaluate((artist) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([{ artist, hype: 'nearby' }]),
			)
		}, ARTIST)
		const listsBefore = callsOf(calls, 'TicketJourneyService/List').length
		await page.goto('/timetable')
		await expect(card(page).first()).toBeVisible({ timeout: 30_000 })
		await expect(card(page).getByTestId('journey-badge')).toHaveCount(0)
		expect(callsOf(calls, 'TicketJourneyService/List')).toHaveLength(
			listsBefore,
		)
	})
})

test.describe('a guest request for ticket sale notifications survives sign-up', () => {
	// @spec components/infrastructure/fan/web/global/concert-sheet "Back after sign-up"
	test(`@spec ${TRACK} "Guest signs up from the notification button"`, {
		tag: '@flow',
	}, async ({ page }) => {
		await seedGuest(page)
		await undecidedNotifications(page)
		const journeys = new Map<string, string>()
		const calls = await mockBackend(page, journeys)
		await mockIdentityProvider(page)
		await page.goto('/timetable')
		await openSheet(page)
		await expect(sheet(page).getByTestId('sheet-notify-guide')).toBeVisible()
		await flowShot(page, 'A guest opens a concert: the 🔔 guide moment')

		// @spec components/infrastructure/fan/web/global/concert-sheet "Guest presses the button"
		// @spec stories/sign-up-or-sign-in "Sign-up from the notification button"
		await pressNotifyAndChoose(page, 'Sign Up', 'The sign-up dialog')

		// Back from sign-up on the same concert's sheet, tracking it.
		await expect(page).toHaveURL(
			new RegExp(`/timetable\\?.*concert=${EVENT_ID}$`),
			{
				timeout: 30_000,
			},
		)
		await expect(notifyButton(page)).toHaveText(
			'🔔 チケット販売の通知を受け取り中 ✓',
			{ timeout: 30_000 },
		)
		const setStatus = callsOf(calls, 'TicketJourneyService/SetStatus')
		expect(setStatus).toHaveLength(1)
		expect(setStatus[0].body).toMatchObject({
			eventId: { value: EVENT_ID },
			status: TRACKING,
		})
		// After the account exists.
		expect(
			calls.findIndex((c) => c.method === 'UserService/Create'),
		).toBeLessThan(
			calls.findIndex((c) => c.method === 'TicketJourneyService/SetStatus'),
		)

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Back from sign-up"
		// No celebration over or behind the sheet, and no post-signup dialog yet.
		await expect(celebration(page)).toHaveCount(0)
		await expect(page.getByText(TRACK_STEP_TITLE)).toHaveCount(0)
		await flowShot(page, 'Back from sign-up: the same concert, tracking')

		// The Timetable card shows the bell.
		await page.keyboard.press('Escape')
		await expect(card(page).getByTestId('journey-badge')).toHaveAttribute(
			'data-journey-status',
			'tracking',
			{ timeout: 30_000 },
		)
		await expect(card(page).getByTestId('journey-badge')).toHaveText('🔔')

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Closing the sheet"
		// Closing the sheet opens the notification step, and still no celebration.
		await expect(page.getByText(TRACK_STEP_TITLE)).toBeVisible()
		await flowShot(page, 'Sheet closed: turn on push')
		await expect(
			page.getByText('フォロー中の1組のライブを探し始めました'),
		).toHaveCount(0)
		await expect(celebration(page)).toHaveCount(0)
	})

	test(`@spec ${TRACK} "Sign-up abandoned"`, async ({ page }) => {
		await seedGuest(page)
		const calls = await mockBackend(page, new Map())
		// Hosted login answers with a page the guest leaves without signing up.
		await page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) =>
			route.fulfill({ contentType: 'text/html', body: '<p>login</p>' }),
		)
		await page.goto('/timetable')
		await openSheet(page)
		await pressNotifyAndChoose(page, 'Sign Up')
		await page.waitForURL((url) => url.hostname.startsWith('auth.'))

		// Later, a sign-up from the Timetable banner completes.
		await page.unroute(`${OIDC_AUTHORITY}/oauth/v2/authorize**`)
		await mockIdentityProvider(page)
		await page.goto('/timetable')
		await page
			.locator('signup-prompt-banner .bottom-banner-action')
			.click({ timeout: 30_000 })
		await page.waitForURL((url) => url.pathname === '/timetable', {
			timeout: 30_000,
		})
		await expect
			.poll(() => callsOf(calls, 'UserService/Create').length, {
				timeout: 30_000,
			})
			.toBe(1)

		expect(callsOf(calls, 'TicketJourneyService/SetStatus')).toHaveLength(0)
	})

	// @spec components/infrastructure/fan/web/global/concert-sheet "Guest chooses later"
	// @spec stories/sign-up-or-sign-in "Sign-up from the ticket sale notification button"
	test(`@spec ${TRACK} "Guest chooses later"`, {
		tag: '@flow',
	}, async ({ page }) => {
		await seedGuest(page)
		const calls = await mockBackend(page, new Map())
		await mockIdentityProvider(page)
		await page.goto('/timetable')
		await openSheet(page)

		await pressNotifyAndChoose(page, 'あとで', 'The sign-up dialog')

		await expect(signUpDialog(page)).toHaveCount(0)
		await expect(notifyButton(page)).toBeVisible()
		await flowShot(page, 'Later: the sheet as it was')
		expect(new URL(page.url()).pathname).toBe('/timetable')

		// Later, a sign-up from the Timetable banner tracks nothing.
		await page.keyboard.press('Escape')
		await page
			.locator('signup-prompt-banner .bottom-banner-action')
			.click({ timeout: 30_000 })
		await expect
			.poll(() => callsOf(calls, 'UserService/Create').length, {
				timeout: 30_000,
			})
			.toBe(1)
		expect(callsOf(calls, 'TicketJourneyService/SetStatus')).toHaveLength(0)
	})
})

test.describe('ticket section layout', () => {
	test.use({ viewport: { width: 320, height: 640 } })

	test('@spec components/infrastructure/fan/web/route/timetable "Narrow viewport does not overflow"', async ({
		page,
	}) => {
		await page.context().addInitScript(
			({ sub, email }) => {
				localStorage.setItem('onboardingComplete', 'true')
				localStorage.setItem('onboarding.celebrationShown', '1')
				localStorage.setItem('onboarding.helpSeen:timetable', '1')
				localStorage.setItem('pwa.installed', 'true')
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
		await mockBackend(page, new Map())
		await page.route('**/liverty_music.rpc.v1.UserService/Get', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ user: USER }),
			}),
		)
		await page.goto('/timetable')
		await openSheet(page)

		const row = sheet(page).locator('.journey-row')
		await expect(row).toBeVisible()
		const layout = await row.evaluate((el) => {
			const buttons = [...el.querySelectorAll('button')]
			return {
				overflow: el.scrollWidth - el.clientWidth,
				rows: new Set(buttons.map((b) => b.getBoundingClientRect().top)).size,
				right: Math.max(...buttons.map((b) => b.getBoundingClientRect().right)),
				smallest: Math.min(
					...buttons.map((b) => b.getBoundingClientRect().height),
				),
			}
		})
		// The row wraps onto more lines instead of overflowing the screen.
		expect(layout.overflow).toBeLessThanOrEqual(0)
		expect(layout.rows).toBeGreaterThan(1)
		expect(layout.right).toBeLessThanOrEqual(320)
		// The 48 px tap of timetable "Canonical presentation kept"; its labels,
		// icons and hues are checked in concert-sheet.fixture.spec.ts.
		expect(layout.smallest).toBeGreaterThanOrEqual(48)
	})
})
