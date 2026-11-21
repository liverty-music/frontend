import type { Browser, Page } from '@playwright/test'
import { APP_ORIGIN } from '../support/app-origin'
import { installAuthMocks } from '../support/auth-mocks'
import {
	FAN_EMAIL,
	mockFanRpc,
	mockIdentityProvider,
} from '../support/fan-auth'
import { expect, test } from '../support/test'

/**
 * When the per-level hype snack flags are cleared: when the guest's local
 * data is reset at sign-in and when sign-up completes, never on [Get Started].
 * The seen guide moments are kept through all three.
 */

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })

/** The flags cleared at the reset, and the guide marks kept through it. */
const SNACK_FLAGS = [
	'onboarding.hypeSnackSeen:away',
	'onboarding.hypeSnackSeen:home',
]
const GUIDE_MARKS = ['guide.seen:discovery.follow', 'guide.seen:myArtists.hype']

const USER = {
	user: {
		id: { value: '00000000-0000-4000-8000-c00000000002' },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

/** A fresh guest device that saw two hype snacks and two guide moments. */
async function freshGuest(browser: Browser): Promise<Page> {
	const context = await browser.newContext({ baseURL: APP_ORIGIN })
	const page = await context.newPage()
	await installAuthMocks(page)
	await context.addInitScript(
		(keys) => {
			if (localStorage.getItem('__e2e_seeded')) return
			localStorage.setItem('__e2e_seeded', '1')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			for (const key of keys) localStorage.setItem(key, '1')
		},
		[...SNACK_FLAGS, ...GUIDE_MARKS],
	)
	await mockFanRpc(page, { 'UserService/Get': USER })
	await mockIdentityProvider(page)
	return page
}

function stored(page: Page, keys: string[]): Promise<(string | null)[]> {
	return page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), keys)
}

async function expectReset(page: Page, cleared: boolean): Promise<void> {
	expect(await stored(page, SNACK_FLAGS)).toEqual(
		cleared ? [null, null] : ['1', '1'],
	)
	// @spec components/infrastructure/fan/web/global/guide-moment "Sign-up keeps seen moments"
	expect(await stored(page, GUIDE_MARKS)).toEqual(['1', '1'])
}

test('@spec components/infrastructure/fan/web/global/page-help "Help-seen flags cleared on fresh onboarding"', async ({
	browser,
}) => {
	// [Get Started] on Welcome keeps the flags.
	const getStarted = await freshGuest(browser)
	await getStarted.goto('/')
	await getStarted
		.getByTestId('welcome-get-started')
		.first()
		.click({ timeout: 30_000 })
	await expect(getStarted).toHaveURL(/\/discovery/, { timeout: 20_000 })
	await expectReset(getStarted, false)
	await getStarted.context().close()

	// Sign-in from Welcome resets the guest's local data, the snack flags
	// included.
	const signIn = await freshGuest(browser)
	await signIn.goto('/')
	await signIn.getByTestId('welcome-login').first().click({ timeout: 30_000 })
	await expect(signIn).toHaveURL(/\/timetable/, { timeout: 30_000 })
	await expectReset(signIn, true)
	await signIn.context().close()

	// Completing sign-up clears them.
	const signUp = await freshGuest(browser)
	await signUp.goto('/my-artists')
	await signUp
		.locator('signup-prompt-banner .bottom-banner-action')
		.click({ timeout: 30_000 })
	await expect(signUp).toHaveURL(/\/timetable/, { timeout: 30_000 })
	await expectReset(signUp, true)
	await signUp.context().close()
})
