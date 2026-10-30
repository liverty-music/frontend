import { expect, type Page, test } from '@playwright/test'
import { optOutOfAnalytics } from './onboarding'
import { fillAndSubmit, testUser } from './support'

/**
 * The production hosted login offers no way to set a password (patched Login
 * V2, cloud-provisioning `zitadel-login/`). Starts as a guest and creates no
 * account: "Sign-up offers only a passkey" is checked by `delete-my-account`,
 * which continues the sign-up and deletes the account it creates.
 */

const LOGIN = 'https://auth.liverty-music.app/ui/v2/login'

/** Open the hosted login's sign-up page from Settings, as a guest. */
async function openSignUp(page: Page): Promise<URL> {
	await optOutOfAnalytics(page)
	await page.goto('/settings?lang=ja')
	await page.getByTestId('settings-sign-up').click({ timeout: 30_000 })
	await page.waitForURL(/auth\.liverty-music\.app\/.*register/)
	return new URL(page.url())
}

/** The hosted login's not-found page (Next.js renders it with status 200). */
async function expectNotFound(page: Page): Promise<void> {
	await expect(page.getByText('This page could not be found.')).toBeVisible()
	await expect(page.locator('input[type="password"]')).toHaveCount(0)
}

test.describe('hosted login offers no password setup', () => {
	test('password pages opened by address are not found', async ({ page }) => {
		// @spec components/infrastructure/fan/web/global/hosted-login "Password pages opened by address"
		const { search } = await openSignUp(page)
		const params = new URLSearchParams(search)
		const organization = params.get('organization') ?? ''

		for (const path of [
			`/register/password?firstname=E2E&lastname=Probe&email=e2e-probe%40liverty-music.app&organization=${organization}`,
			`/password/set?organization=${organization}`,
			`/password/set?code=ABCDEF&userId=1&organization=${organization}`,
			`/password/change?organization=${organization}`,
		]) {
			await page.goto(`${LOGIN}${path}`)
			await expectNotFound(page)
		}
	})

	test('an invited person typing the set-password address gets not found', async ({
		page,
	}) => {
		// @spec components/infrastructure/organizer/web/global/hosted-login "Set-password page opened by address"
		// The address an invitation's reset link would carry, with no
		// organization or auth request.
		await page.goto(`${LOGIN}/password/set?code=ABCDEF&userId=1`)
		await expectNotFound(page)
	})

	test('the password page offers no password reset', async ({ page }) => {
		// @spec components/infrastructure/fan/web/global/hosted-login "No password reset on the password page"
		await optOutOfAnalytics(page)
		await page.goto('/settings?lang=ja')
		await page.getByTestId('settings-sign-in').click({ timeout: 30_000 })
		await page.waitForURL(/auth\.liverty-music\.app/)
		await fillAndSubmit(
			page,
			'input[name="loginName"], input[autocomplete="username"]',
			testUser().username,
		)

		await page.waitForURL(/\/ui\/v2\/login\/password\?/)
		await expect(page.locator('input[type="password"]')).toBeVisible()
		await expect(page.getByTestId('reset-button')).toHaveCount(0)
		await expect(page.getByText(/パスワードをリセット|リセット/)).toHaveCount(0)
	})
})
