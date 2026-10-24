import type { Locator, Page } from '@playwright/test'
import { FAN_EMAIL, FAN_SUB, mockFanRpc } from './fan-auth'

/**
 * Helpers for specs about the fan app's shell chrome (bottom navigation, page
 * header, FAB): a signed-in fan with every prompt and banner out of the way,
 * on a mocked backend, and box geometry.
 */

export interface ShellSeed {
	/** Saved FAB handedness (`fab.handed`), set once per browser context. */
	handed?: 'left' | 'right'
	/** UI language saved for the app (`language`). */
	language?: 'ja' | 'en'
	/** Leave the app uninstalled, so the install banner shows. */
	installBanner?: boolean
}

/** Seed a signed-in fan with no banner, prompt or area dialog in the way. */
export async function seedSignedInFan(
	page: Page,
	seed: ShellSeed = {},
): Promise<void> {
	await page.context().addInitScript(
		({ sub, email, handed, language, installBanner }) => {
			localStorage.setItem('onboardingComplete', 'true')
			localStorage.setItem('onboarding.celebrationShown', '1')
			if (installBanner) localStorage.removeItem('pwa.installed')
			else localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem('guest.home', 'JP-13')
			if (language) localStorage.setItem('language', language)
			if (handed && !sessionStorage.getItem('__handed_seeded')) {
				sessionStorage.setItem('__handed_seeded', '1')
				localStorage.setItem('fab.handed', handed)
			}
			localStorage.setItem(
				'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					token_type: 'Bearer',
					scope: 'openid profile email',
					profile: { sub, email },
					expires_at: 9999999999,
				}),
			)
		},
		{ sub: FAN_SUB, email: FAN_EMAIL, ...seed },
	)
	await mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: FAN_SUB },
				email: { value: FAN_EMAIL },
				home: { countryCode: 'JP', level1: 'JP-13' },
			},
		},
	})
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

export const nav = (page: Page): Locator => page.locator('bottom-nav-bar nav')
export const tabs = (page: Page): Locator => page.locator('.nav-tab')
export const fab = (page: Page): Locator => page.locator('fab-menu .fab-toggle')
export const fabItems = (page: Page): Locator =>
	page.locator('fab-menu .fab-item')

/** Open `path` and wait until the bar shows its four tabs. */
export async function openShell(page: Page, path: string): Promise<void> {
	await page.goto(path)
	await tabs(page).nth(3).waitFor({ timeout: 30_000 })
}

/** Navigate inside the app by tapping the tab with this icon. */
export async function tapTab(page: Page, icon: string): Promise<void> {
	await page.locator(`.nav-tab[data-nav="${icon}"]`).click()
}

export interface Box {
	x: number
	y: number
	width: number
	height: number
}

export async function box(locator: Locator): Promise<Box> {
	const b = await locator.boundingBox()
	if (!b) throw new Error('element has no box')
	return b
}

export function intersects(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	)
}

export const centre = (b: Box) => ({
	x: b.x + b.width / 2,
	y: b.y + b.height / 2,
})

/**
 * Wait until every finite animation and transition under `selector` has
 * finished, so boxes are read at rest. A bottom banner's attention cue
 * (`banner-cue`) only paints and runs for a minute, so it is not waited for.
 */
export async function settle(page: Page, selector: string): Promise<void> {
	await page.waitForFunction((sel) => {
		return [...document.querySelectorAll(sel)].every((el) =>
			el
				.getAnimations({ subtree: true })
				.filter(
					(a) =>
						a.effect?.getTiming().iterations !== Infinity &&
						(a as CSSAnimation).animationName !== 'banner-cue',
				)
				.every((a) => a.playState !== 'running'),
		)
	}, selector)
}

/** Publish a snack through the DEV bridge main.ts exposes. */
export async function publishSnack(
	page: Page,
	message: string,
	durationMs: number,
): Promise<void> {
	await page.waitForFunction(
		() =>
			typeof (window as unknown as Record<string, unknown>)
				.__lm_publishSnack === 'function',
	)
	await page.evaluate(
		({ message, durationMs }) => {
			const publish = (window as unknown as Record<string, unknown>)
				.__lm_publishSnack as (m: string, s: string, d: number) => void
			publish(message, 'info', durationMs)
		},
		{ message, durationMs },
	)
}
