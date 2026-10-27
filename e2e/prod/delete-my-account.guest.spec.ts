import { randomBytes } from 'node:crypto'
import { devices, expect, type Page, test } from '@playwright/test'
import { optOutOfAnalytics } from './onboarding'
import { fillAndSubmit } from './support'

/**
 * Story `delete-my-account` against production, with a throwaway account the
 * spec signs up itself: it deletes the account from Settings after the fresh
 * sign-in, checks the account no longer signs in, signs up again with the
 * same email address and deletes that account too, so a run leaves no
 * account behind.
 *
 * The throwaway account holds no ticket. The scenarios that need one
 * ("Ticket for next week", "After the concert") and the order and ticket
 * records kept after deletion are recorded in `docs/ci-coverage-gaps.md`.
 *
 * Starts as a guest (`prod-guest`). The password is generated per run and
 * never written anywhere, and no trace, screenshot or video is kept: they
 * would record it and the account's tokens.
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'

/** The throwaway account of this run, on the prod test account domain. */
const ACCOUNT = {
	email: `e2e-delete-account-${Date.now()}@liverty-music.app`,
	// Meets the hosted login's password policy: upper, lower, digit, symbol.
	password: `Aa1!${randomBytes(12).toString('hex')}`,
}

/** The signed-in fan's identity (`sub`) from the app's stored OIDC session. */
function signedInFan(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const key = Object.keys(localStorage).find((k) =>
			k.startsWith('oidc.user:'),
		)
		const value = key ? localStorage.getItem(key) : null
		return value
			? (JSON.parse(value) as { profile: { sub: string } }).profile.sub
			: null
	})
}

/**
 * Call a fan RPC with the signed-in fan's access token. Returns the HTTP
 * status and the Connect JSON body.
 */
function callAsFan(
	page: Page,
	path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	return page.evaluate(
		async ({ url }) => {
			const key = Object.keys(localStorage).find((k) =>
				k.startsWith('oidc.user:'),
			)
			const user = key
				? (JSON.parse(localStorage.getItem(key) ?? '{}') as {
						access_token?: string
					})
				: {}
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${user.access_token ?? ''}`,
				},
				body: '{}',
			})
			return { status: res.status, body: await res.json() }
		},
		{ url: `${API_BASE}/${path}` },
	)
}

/**
 * Sign up from Settings as a guest with a password, and wait until the app
 * has the new account signed in.
 */
async function signUp(page: Page): Promise<void> {
	await page.goto('/settings?lang=ja')
	await page.getByTestId('settings-sign-up').click({ timeout: 30_000 })
	await page.waitForURL(/auth\.liverty-music\.app\/.*register/)

	// The form does not register a value filled before it has hydrated.
	for (const [name, value] of [
		['firstname', 'E2E'],
		['lastname', 'Delete'],
		['email', ACCOUNT.email],
	]) {
		const input = page.locator(`input[name="${name}"]`)
		await expect(async () => {
			await input.fill(value)
			expect(await input.inputValue()).toBe(value)
		}).toPass()
	}
	await page.getByText('パスワード', { exact: true }).click()
	await page.getByRole('button', { name: '続行' }).click()

	await page.locator('input[name="confirmPassword"]').waitFor()
	await page.locator('input[name="password"]').fill(ACCOUNT.password)
	await page.locator('input[name="confirmPassword"]').fill(ACCOUNT.password)
	await page.getByRole('button', { name: '続行' }).click()

	// Back in the app once the sign-up callback has run.
	await page.waitForURL(
		(u) => !u.hostname.startsWith('auth.') && !u.pathname.startsWith('/auth/'),
		{ timeout: 60_000 },
	)
	await expect.poll(() => signedInFan(page)).not.toBeNull()
}

/**
 * Delete the signed-in account from Settings: the withdrawal screen, its
 * confirmation dialog, the fresh sign-in with the password, then the
 * deleted-account view.
 */
async function deleteFromSettings(page: Page): Promise<void> {
	await page.goto('/settings')
	await page.getByTestId('settings-delete-account').click({ timeout: 30_000 })
	await expect(page).toHaveURL(/\/settings\/delete-account$/)

	await expect(page.getByTestId('delete-account-statements')).toBeVisible()
	await expect(page.getByTestId('delete-account-blocker')).toHaveCount(0)
	await page.getByTestId('delete-account-delete').click()
	await expect(page.getByTestId('delete-account-confirm')).toBeVisible()
	await page.getByTestId('delete-account-confirm-delete').click()

	// The fresh sign-in asks for the password again, even right after sign-up.
	await page.waitForURL(/auth\.liverty-music\.app\/ui\/v2\/login\/password/)
	await fillAndSubmit(page, 'input[type="password"]', ACCOUNT.password)

	await expect(page.getByTestId('delete-account-deleted')).toBeVisible({
		timeout: 60_000,
	})
	await expect(page).toHaveURL(/\/settings\/delete-account$/)
	expect(await signedInFan(page)).toBeNull()
}

test.describe('delete my account', () => {
	// The second test signs up again with the email the first one deleted.
	test.describe.configure({ mode: 'serial' })
	let deletedFan = ''

	test.beforeEach(async ({ page }) => {
		await optOutOfAnalytics(page)
	})

	// A failed test may leave the account it signed up in production: delete
	// it while the page still holds its session, or name it for an admin.
	test.afterEach(async ({ page }, testInfo) => {
		if (testInfo.status === testInfo.expectedStatus) return
		testInfo.setTimeout(testInfo.timeout + 120_000)
		const deleted = await (async () => {
			if (!(await signedInFan(page))) return false
			await deleteFromSettings(page)
			return true
		})().catch(() => false)
		if (!deleted) {
			console.warn(
				`${ACCOUNT.email} may be left in production: delete it on the admin console's Users screen`,
			)
		}
	})

	test('a fan with nothing in progress deletes their account and can no longer sign in', async ({
		page,
		browser,
		baseURL,
	}) => {
		// @spec stories/delete-my-account "Fan whose concerts are over"
		test.setTimeout(240_000)
		await signUp(page)
		deletedFan = (await signedInFan(page)) ?? ''

		await deleteFromSettings(page)

		// The welcome link leaves the deleted-account view signed out.
		await page.getByTestId('delete-account-to-welcome').click()
		await expect(page).toHaveURL(/\/welcome/)

		// Signing in with the same credentials no longer reaches an account.
		// On a fresh device: this browser's hosted login still offers the
		// deleted account in its account chooser.
		const device = await browser.newContext({
			...devices['Pixel 7'],
			baseURL,
			locale: 'ja-JP',
			timezoneId: 'Asia/Tokyo',
		})
		try {
			const other = await device.newPage()
			await optOutOfAnalytics(other)
			await other.goto('/settings?lang=ja')
			await other.getByTestId('settings-sign-in').click({ timeout: 30_000 })
			await other.waitForURL(/auth\.liverty-music\.app/)
			await fillAndSubmit(other, 'input[name="loginName"]', ACCOUNT.email)
			await fillAndSubmit(other, 'input[type="password"]', ACCOUNT.password)
			await expect(other.getByText('認証に失敗しました。')).toBeVisible()
			await expect(other).toHaveURL(/auth\.liverty-music\.app/)
		} finally {
			await device.close()
		}
	})

	test('signing up again with the same email starts a new, empty account', async ({
		page,
	}) => {
		// @spec stories/delete-my-account "Signing up again"
		test.setTimeout(240_000)
		test.skip(!deletedFan, 'needs the account the previous test deleted')
		await signUp(page)

		const fan = await signedInFan(page)
		expect(fan).not.toBe(deletedFan)

		const follows = await callAsFan(
			page,
			'liverty_music.rpc.follow.v1.FollowService/List',
		)
		expect(follows.status).toBe(200)
		expect(follows.body.artists ?? []).toEqual([])

		const tickets = await callAsFan(
			page,
			'liverty_music.rpc.ticket.v1.TicketService/List',
		)
		expect(tickets.status).toBe(200)
		expect(tickets.body.tickets ?? []).toEqual([])

		// No identity check (本人確認) result: Get answers NotFound.
		const verification = await callAsFan(
			page,
			'liverty_music.rpc.identity_verification.v1.IdentityVerificationService/Get',
		)
		expect(verification.body.code).toBe('not_found')

		// Leave no account behind.
		await deleteFromSettings(page)
	})
})
