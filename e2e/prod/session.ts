import { existsSync } from 'node:fs'
import {
	type Browser,
	type BrowserContext,
	test as base,
	devices,
} from '@playwright/test'

/**
 * Sessions of the production test accounts, kept current across a run.
 *
 * Zitadel rotates a refresh token on every use and rejects the old one, and an
 * access token lasts about 30 minutes. A session file therefore signs in only
 * until its refresh token is first used, unless the session is written back
 * after use. Every context opened from one of these files writes it back
 * before it closes. See docs/prod-e2e-fixtures.md.
 */

/** The prod E2E test user, the project's signed-in fan. */
export const FAN_STATE = '.auth/storageState.prod.json'
export const SECOND_FAN_STATE = '.auth/storageState.prod.fan2.json'
export const THIRD_FAN_STATE = '.auth/storageState.prod.fan3.json'
/** The e2e-test Organizer's test member, signed in with a virtual passkey. */
export const ORGANIZER_STATE = '.auth/storageState.organizer.prod.json'

const ORGANIZER_CONSOLE =
	process.env.PROD_ORGANIZER_BASE_URL ?? 'https://organizer.liverty-music.app'

/**
 * `test` whose context writes the project's session file back when the test
 * ends, so the next test starts from the rotated refresh token.
 */
export const test = base.extend({
	context: async ({ context, storageState }, use) => {
		await use(context)
		if (typeof storageState === 'string') {
			await context.storageState({ path: storageState })
		}
	},
})

/** A signed-in context for another fan, on the project's device. */
export function fanContext(
	browser: Browser,
	baseURL: string | undefined,
	storageState: string,
): Promise<BrowserContext> {
	return browser.newContext({
		...devices['Pixel 7'],
		baseURL,
		locale: 'ja-JP',
		timezoneId: 'Asia/Tokyo',
		storageState,
	})
}

/** Write the fan's session back to its file, then close the context. */
export async function closeFan(
	context: BrowserContext,
	storageState: string,
): Promise<void> {
	await context.storageState({ path: storageState })
	await context.close()
}

/** Whether the test member's session file exists. */
export function hasOrganizerSession(): boolean {
	return existsSync(ORGANIZER_STATE)
}

let organizer: { token: string; expiresAt: number } | undefined

/**
 * An access token of the e2e-test Organizer's test member, valid for at least
 * 5 more minutes. Opening the organizer console renews it; the session,
 * passkey included, is written back to its file.
 */
export async function organizerToken(browser: Browser): Promise<string> {
	if (organizer && organizer.expiresAt - Date.now() > 5 * 60 * 1000) {
		return organizer.token
	}
	const context = await browser.newContext({ storageState: ORGANIZER_STATE })
	try {
		const page = await context.newPage()
		await page.goto(`${ORGANIZER_CONSOLE}/?org=e2e-test`)
		await page.waitForLoadState('networkidle')
		const user = await page.evaluate(() => {
			const key = Object.keys(localStorage).find((k) =>
				k.startsWith('oidc.user:'),
			)
			const value = key ? localStorage.getItem(key) : null
			return value
				? (JSON.parse(value) as { access_token: string; expires_at: number })
				: null
		})
		if (!user || user.expires_at * 1000 <= Date.now()) {
			throw new Error(
				`${ORGANIZER_STATE} no longer signs in: see docs/prod-e2e-fixtures.md`,
			)
		}
		// Without credentials the file would lose the member's passkey.
		await context.storageState({ path: ORGANIZER_STATE, credentials: true })
		organizer = { token: user.access_token, expiresAt: user.expires_at * 1000 }
		return organizer.token
	} finally {
		await context.close()
	}
}
