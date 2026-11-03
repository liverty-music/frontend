import { OIDC_AUTHORITY } from '../support/auth-mocks'
import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import {
	callsOf,
	connectError,
	FAN_EMAIL,
	mockFanRpc,
	mockIdentityProvider,
} from '../support/fan-auth'
import {
	enableAnalytics,
	named,
	recordPostHog,
	type SentEvent,
} from '../support/posthog'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * Every start of sign-up or sign-in is reported with where it started, just
 * before the app leaves for hosted login. PostHog and the backend are mocked;
 * hosted login answers with an empty page, so the test sees the moment the
 * app leaves.
 */

const STORY = 'stories/sign-up-or-sign-in'

/** Seed a guest who finished onboarding, once per test. */
async function seedGuest(
	page: Page,
	extra: Record<string, string> = {},
): Promise<void> {
	await page.context().addInitScript((extra) => {
		if (localStorage.getItem('__e2e_seeded')) return
		localStorage.setItem('__e2e_seeded', '1')
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('ui.notificationPromptDismissed', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
	}, extra)
}

/**
 * Answer the hosted login's authorize request with an empty page and resolve
 * with the time the app left for it.
 */
function leavesForHostedLogin(page: Page): Promise<number> {
	return new Promise((resolve) => {
		void page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) => {
			resolve(Date.now())
			return route.fulfill({ contentType: 'text/html', body: '<p>login</p>' })
		})
	})
}

/** Wait until the app has loaded the SDK (its first page view arrived). */
async function analyticsReady(events: SentEvent[]): Promise<void> {
	await expect
		.poll(() => named(events, '$pageview').length, { timeout: 20_000 })
		.toBeGreaterThan(0)
}

test.describe('starts of sign-up and sign-in are reported', () => {
	test.beforeEach(async ({ page }) => {
		await mockFanRpc(page)
		await enableAnalytics(page)
	})

	test(`@spec ${STORY} "Sign-up from a banner"`, async ({ page }) => {
		await seedGuest(page)
		const events = await recordPostHog(page)
		const left = leavesForHostedLogin(page)
		await page.goto('/dashboard')
		await analyticsReady(events)

		await page.locator('.signup-banner-action').click({ timeout: 20_000 })
		const leftAt = await left

		await expect
			.poll(() => named(events, 'auth.started'), { timeout: 15_000 })
			.toHaveLength(1)
		const [started] = named(events, 'auth.started')
		expect(started.properties).toMatchObject({
			kind: 'sign_up',
			source: 'dashboard_prompt',
		})
		// Captured before the app left for hosted login.
		expect(Date.parse(started.timestamp ?? '')).toBeLessThanOrEqual(leftAt)
	})

	test(`@spec ${STORY} "Sign-in from the landing page"`, async ({ page }) => {
		const events = await recordPostHog(page)
		const left = leavesForHostedLogin(page)
		await page.goto('/welcome')
		await analyticsReady(events)

		await page.getByTestId('welcome-login').first().click({ timeout: 20_000 })
		await left

		await expect
			.poll(() => named(events, 'auth.started'), { timeout: 15_000 })
			.toHaveLength(1)
		expect(named(events, 'auth.started')[0].properties).toMatchObject({
			kind: 'sign_in',
			source: 'welcome',
		})
	})

	test(`@spec ${STORY} "Analytics off"`, async ({ page }) => {
		await seedGuest(page, {
			'consent.state': JSON.stringify({
				version: 2,
				analytics: false,
				sessionReplay: true,
			}),
		})
		const events = await recordPostHog(page)
		const left = leavesForHostedLogin(page)
		await page.goto('/settings')

		await page.getByTestId('settings-sign-up').click({ timeout: 20_000 })
		await left
		// Give a suppressed capture time to have arrived.
		// biome-ignore lint/suspicious/noPlaywrightWaitForTimeout: an absence check; a suppressed capture has no event to wait for
		await page.waitForTimeout(1_500)

		expect(named(events, 'auth.started')).toEqual([])
	})
})

test.describe('a new account without a home', () => {
	test.use({ locale: 'ja-JP' })
	const EVENT_ID = fakeId('signup-home-event')
	const USER_ID = '00000000-0000-4000-8000-c00000000002'

	function concert() {
		const d = new Date()
		d.setDate(d.getDate() + 30)
		return {
			id: { value: EVENT_ID },
			performers: [
				{
					id: { value: fakeId('signup-home-artist') },
					name: { value: 'The Band' },
					mbid: { value: '' },
				},
			],
			series: {
				id: { value: fakeId('signup-home-series') },
				title: { value: 'Home Tour 2026' },
				publishState: 'PUBLISH_STATE_PUBLISHED',
			},
			localDate: {
				value: {
					year: d.getFullYear(),
					month: d.getMonth() + 1,
					day: d.getDate(),
				},
			},
			venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
		}
	}

	// @spec components/infrastructure/fan/web/global/user-home-selector "New account without a home opens the Dashboard"
	// @spec components/infrastructure/fan/web/global/user-home-selector "Event page does not ask"
	// @spec components/infrastructure/fan/web/global/user-home-selector "Sheet left without a choice"
	test(`@spec ${STORY} "Sign-up from the event page without a home"`, async ({
		page,
	}) => {
		let home: Record<string, unknown> | undefined
		const calls = await mockFanRpc(page, {
			'ConcertService/Get': concertWire({ concert: concert() }),
			'ConcertService/ListBySeries': concertWire({ concerts: [concert()] }),
			// No account for this identity until Create stores one; Create
			// succeeds without a home.
			'UserService/Get': () =>
				callsOf(calls, 'UserService/Create').length > 0
					? { body: { user: user(home) } }
					: connectError('not_found', 404),
			'UserService/Create': () => ({ body: { user: user(home) } }),
			'UserService/SetHome': (body) => {
				home = body.home as Record<string, unknown>
				return { body: { user: user(home) } }
			},
		})
		await mockIdentityProvider(page)

		await page.goto(`/events/${EVENT_ID}`)
		await expect(page.getByText('Home Tour 2026').first()).toBeVisible({
			timeout: 20_000,
		})
		await page.getByTestId('event-signup').click()

		// The account is created without a home and the event page opens again,
		// signed in, with no home sheet.
		await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}$`), {
			timeout: 20_000,
		})
		await expect(page.getByTestId('event-signup')).toHaveCount(0)
		expect(
			callsOf(calls, 'UserService/Create').at(-1)?.body.home,
		).toBeUndefined()
		const sheet = page.locator('user-home-selector .selector-content')
		await expect(sheet).toHaveCount(0)

		// The Dashboard asks for the home in a sheet that cannot be closed.
		await page.goto('/dashboard')
		await expect(sheet).toBeVisible({ timeout: 20_000 })
		await page.keyboard.press('Escape')
		await page.mouse.click(5, 5)
		await expect(sheet).toBeVisible()
		expect(callsOf(calls, 'UserService/SetHome')).toHaveLength(0)

		// Leaving without a choice: closing and reopening the app asks again,
		// still signed in (the app reads the account on start).
		const getsBefore = callsOf(calls, 'UserService/Get').length
		await page.reload()
		await expect(sheet).toBeVisible({ timeout: 20_000 })
		await expect
			.poll(() => callsOf(calls, 'UserService/Get').length)
			.toBeGreaterThan(getsBefore)

		// Choosing 東京 saves JP-13 to the account and closes the sheet.
		await sheet.getByRole('button', { name: '東京', exact: true }).click()
		await expect(sheet).toBeHidden()
		expect(
			callsOf(calls, 'UserService/SetHome').at(-1)?.body.home,
		).toMatchObject({
			countryCode: 'JP',
			level1: 'JP-13',
		})
	})

	function user(home?: Record<string, unknown>) {
		return {
			id: { value: USER_ID },
			email: { value: FAN_EMAIL },
			preferredLanguage: 'ja',
			...(home ? { home } : {}),
		}
	}
})
