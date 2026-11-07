import {
	FAN_EMAIL,
	FAN_SUB,
	mockFanRpc,
	seedSignedIn,
} from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * A signed-in fan reopens the app against a mocked backend: what they see comes
 * from their account, not from what the device kept before sign-in.
 */

const CAPABILITY = 'stories/restore-session-on-cold-start'
const ARTIST_NAME = 'Restored Band'

async function reopen(page: Page) {
	await page.context().addInitScript(seedSignedIn, {
		sub: FAN_SUB,
		email: FAN_EMAIL,
	})
	await page.context().addInitScript(() => {
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
		// The device kept Japanese from before sign-in.
		localStorage.setItem('language', 'ja')
	})
	return mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: '00000000-0000-4000-8000-c00000000002' },
				email: { value: FAN_EMAIL },
				preferredLanguage: 'en',
				home: { countryCode: 'JP', level1: 'JP-27' },
			},
		},
		'FollowService/List': FOLLOWED,
	})
}

const FOLLOWED = {
	artists: [
		{
			artist: {
				id: { value: '00000000-0000-4000-8000-a00000000001' },
				name: { value: ARTIST_NAME },
			},
			hype: 'HYPE_TYPE_AWAY',
		},
	],
}

test.describe('reopening the app', () => {
	test(`@spec ${CAPABILITY} "Reopen with a remembered account" @spec ${CAPABILITY} "Language chosen on another device"`, async ({
		page,
	}) => {
		const calls = await reopen(page)

		await page.goto('/settings')

		// The account's language wins over the one the device kept.
		await expect(page.locator('html')).toHaveAttribute('lang', 'en')
		// The account's home.
		await expect(page.getByText('Osaka').first()).toBeVisible()
		// The account's follows.
		await page.goto('/my-artists')
		await expect(page.getByText(ARTIST_NAME).first()).toBeVisible()
		// The account is read, and nothing writes the device's language to it.
		expect(calls.map((c) => c.method)).toContain('UserService/Get')
		expect(calls.map((c) => c.method)).not.toContain(
			'UserService/SetPreferredLanguage',
		)
	})
})
