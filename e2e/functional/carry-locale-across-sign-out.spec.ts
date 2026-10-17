import { OIDC_AUTHORITY } from '../support/auth-mocks'
import {
	connectError,
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
} from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * A signed-in fan whose account language is Japanese, on a browser whose
 * preferred language is English, leaves the session (a sign-out, or a session
 * that can no longer be renewed). The app reloads as a guest and must open in
 * Japanese, not re-detect English from the browser. The backend and the
 * identity provider are mocked.
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/i18n'
const USER = {
	user: {
		id: { value: '00000000-0000-4000-8000-c00000000002' },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

test.use({ locale: 'en-US' })

/** Seed the device once: a signed-in fan with no saved language yet. */
async function seedSignedInOnce(page: Page): Promise<void> {
	await page.context().addInitScript(
		({ sub, email }) => {
			if (localStorage.getItem('__e2e_seeded')) return
			localStorage.setItem('__e2e_seeded', '1')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('ui.notificationPromptDismissed', 'true')
			// Keep the install banner from covering the Sign out row.
			localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem(
				'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					refresh_token: 'fake-refresh-token',
					token_type: 'Bearer',
					scope: 'openid profile email offline_access',
					profile: { sub, email },
					expires_at: 9999999999,
				}),
			)
		},
		{ sub: FAN_SUB, email: FAN_EMAIL },
	)
}

/** The Welcome page is shown, in Japanese, and declares Japanese. */
async function expectWelcomeInJapanese(page: Page): Promise<void> {
	await expect(
		page.getByRole('button', { name: 'ログイン' }).first(),
	).toBeVisible()
	await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
}

test.describe('the language survives leaving the session', () => {
	test(`@spec ${CAPABILITY} "Welcome after sign-out keeps the account's language"`, async ({
		page,
	}) => {
		await seedSignedInOnce(page)
		await mockFanRpc(page, { 'UserService/Get': USER })
		// The identity provider ends the session and returns to the app.
		await page.route(`${OIDC_AUTHORITY}/oidc/v1/end_session**`, (route) => {
			const url = new URL(route.request().url())
			return route.fulfill({
				status: 302,
				headers: {
					location: url.searchParams.get('post_logout_redirect_uri') ?? '/',
				},
			})
		})

		await page.goto('/settings')
		// The account's language replaces the browser's English.
		const signOut = page.getByRole('button', { name: 'サインアウト' })
		await expect(signOut).toBeVisible()

		await signOut.click()

		await page.waitForURL((url) => url.pathname === '/welcome')
		await expectWelcomeInJapanese(page)
		await page.reload()
		await expectWelcomeInJapanese(page)
	})

	test(`@spec ${CAPABILITY} "Involuntary logout keeps the language"`, async ({
		page,
	}) => {
		await seedSignedInOnce(page)
		let sessionLapsed = false
		await mockFanRpc(page, {
			'UserService/Get': () =>
				sessionLapsed ? connectError('unauthenticated', 401) : { body: USER },
		})
		// The refresh token can no longer be renewed.
		await page.route(`${OIDC_AUTHORITY}/oauth/v2/token`, (route) =>
			route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'invalid_grant' }),
			}),
		)

		await page.goto('/settings')
		await expect(
			page.getByRole('button', { name: 'サインアウト' }),
		).toBeVisible()

		// The next boot finds the session lapsed: the backend rejects the token
		// and the refresh fails, so the app logs the fan out to Welcome.
		sessionLapsed = true
		await page.reload()

		await page.waitForURL((url) => url.pathname === '/welcome')
		await expectWelcomeInJapanese(page)
	})
})
