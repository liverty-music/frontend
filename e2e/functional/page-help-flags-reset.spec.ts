import type { Browser, Page } from '@playwright/test'
import { installAuthMocks } from '../support/auth-mocks'
import {
	FAN_EMAIL,
	mockFanRpc,
	mockIdentityProvider,
} from '../support/fan-auth'
import { expect, test } from '../support/test'

/**
 * When the per-page help-seen flags are cleared: when the guest's local data
 * is reset at sign-in and when sign-up completes, never on [Get Started].
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })

const PAGES = ['discovery', 'dashboard', 'my-artists'] as const

const USER = {
	user: {
		id: { value: '00000000-0000-4000-8000-c00000000002' },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

/** A fresh guest device whose help sheets were all seen once. */
async function freshGuest(browser: Browser): Promise<Page> {
	const context = await browser.newContext({ baseURL: 'http://localhost:9000' })
	const page = await context.newPage()
	await installAuthMocks(page)
	await context.addInitScript((pages) => {
		if (localStorage.getItem('__e2e_seeded')) return
		localStorage.setItem('__e2e_seeded', '1')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		for (const p of pages) localStorage.setItem(`onboarding.helpSeen:${p}`, '1')
	}, PAGES)
	await mockFanRpc(page, { 'UserService/Get': USER })
	await mockIdentityProvider(page)
	return page
}

function helpSeen(page: Page): Promise<(string | null)[]> {
	return page.evaluate(
		(pages) =>
			pages.map((p) => localStorage.getItem(`onboarding.helpSeen:${p}`)),
		PAGES,
	)
}

test('@spec components/infrastructure/fan/web/global/page-help "Help-seen flags cleared on fresh onboarding"', async ({
	browser,
}) => {
	// [Get Started] on Welcome keeps the flags.
	const getStarted = await freshGuest(browser)
	await getStarted.goto('/')
	await getStarted
		.locator('.welcome-btn-primary')
		.first()
		.click({ timeout: 30_000 })
	await expect(getStarted).toHaveURL(/\/discovery/, { timeout: 20_000 })
	expect(await helpSeen(getStarted)).toEqual(['1', '1', '1'])
	await getStarted.context().close()

	// Sign-in from Welcome resets the guest's local data, flags included.
	const signIn = await freshGuest(browser)
	await signIn.goto('/')
	await signIn
		.locator('.welcome-btn-secondary')
		.first()
		.click({ timeout: 30_000 })
	await expect(signIn).toHaveURL(/\/dashboard/, { timeout: 30_000 })
	expect(await helpSeen(signIn)).toEqual([null, null, null])
	await signIn.context().close()

	// Completing sign-up clears them.
	const signUp = await freshGuest(browser)
	await signUp.goto('/my-artists')
	await signUp.locator('.signup-banner-btn').click({ timeout: 30_000 })
	await expect(signUp).toHaveURL(/\/dashboard/, { timeout: 30_000 })
	expect(await helpSeen(signUp)).toEqual([null, null, null])
	await signUp.context().close()
})
