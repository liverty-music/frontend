import { OIDC_AUTHORITY } from '../support/auth-mocks'
import { mockFanRpc } from '../support/fan-auth'
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
