import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { EVENTS, fillAndSubmit, testUser } from './support'

/**
 * Story `open-a-shared-event-link`, signed in as the prod E2E test user
 * (`.auth/storageState.prod.json`, from `npm run auth:capture:password:prod`).
 */
test.describe('open a shared event link (signed in)', () => {
	test.beforeAll(() => {
		// Without the captured state this project would silently run as a
		// guest, and guest follows persist locally, so the follow test would
		// still pass. Fail instead.
		if (!existsSync('.auth/storageState.prod.json')) {
			throw new Error(
				'.auth/storageState.prod.json is missing: run npm run auth:capture:password:prod',
			)
		}
	})

	test('keeps a follow made on the event page on the account', async ({
		page,
	}) => {
		test.skip(!EVENTS.public, 'E2E_EVENT_PUBLIC_ID is required')
		await page.goto(`/events/${EVENTS.public}`)
		// The captured session must still be signed in.
		expect(
			await page.evaluate(() =>
				Object.keys(localStorage).some((k) => k.startsWith('oidc.user:')),
			),
		).toBe(true)
		const follow = page.getByTestId('event-follow').first()
		await expect(follow).toBeEnabled()

		// Start from "not followed" so the run is repeatable.
		if ((await follow.getAttribute('aria-pressed')) === 'true') {
			await follow.click()
			await expect(follow).toHaveAttribute('aria-pressed', 'false')
		}
		await follow.click()
		await expect(follow).toHaveAttribute('aria-pressed', 'true')

		// The follow is stored on the account, not only in this page.
		await page.reload()
		await expect(page.getByTestId('event-follow').first()).toHaveAttribute(
			'aria-pressed',
			'true',
		)

		// Leave the account as it was.
		await page.getByTestId('event-follow').first().click()
		await expect(page.getByTestId('event-follow').first()).toHaveAttribute(
			'aria-pressed',
			'false',
		)
	})

	test('returns a guest who follows and signs up to the same event page', async ({
		browser,
		baseURL,
	}) => {
		// @spec stories/open-a-shared-event-link "Guest follows, then signs up"
		test.skip(!EVENTS.upcoming, 'E2E_EVENT_UPCOMING_ID is required')
		const { username, password } = testUser()
		test.skip(!password, '.auth/password.prod.md or E2E_PASSWORD is required')

		// A fresh guest: no storage state. A context made from `browser` does
		// not inherit the project's `use`, so pass the base URL explicitly.
		const context = await browser.newContext({ baseURL })
		const page = await context.newPage()
		await page.goto(`/events/${EVENTS.upcoming}`)

		const follow = page.getByTestId('event-follow').first()
		await expect(follow).toBeEnabled()
		if ((await follow.getAttribute('aria-pressed')) !== 'true') {
			await follow.click()
		}
		await expect(follow).toHaveAttribute('aria-pressed', 'true')

		await page.getByTestId('event-signup').click()
		await page.waitForURL(/auth\.liverty-music\.app/, { waitUntil: 'commit' })

		// The test user already exists, so leave the registration form for the
		// sign-in form; the callback still runs the event-page sign-up flow.
		await page
			.getByRole('link', { name: /log ?in|sign ?in|ログイン/i })
			.or(page.getByRole('button', { name: /log ?in|sign ?in|ログイン/i }))
			.first()
			.click()
		await fillAndSubmit(
			page,
			'input[name="loginName"], input[autocomplete="username"]',
			username,
		)
		await fillAndSubmit(page, 'input[type="password"]', password)

		await page.waitForURL(new RegExp(`/events/${EVENTS.upcoming}$`), {
			timeout: 60_000,
		})
		await expect(page.getByTestId('event-follow').first()).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		// No post-signup celebration or dialog on the event page.
		await expect(page.locator('post-signup-dialog dialog[open]')).toHaveCount(0)
		await context.close()
	})
})
