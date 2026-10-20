import { openShell, seedSignedInFan, tapTab } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The two persistent bottom banners on real screens: one row that fits on one
 * line at every phone width in both languages, their copy, the install
 * banner's cue starting again on each route, and the snack's action keeping
 * the on-container variant (the banners take the filled one).
 */

const INSTALL = 'components/infrastructure/fan/web/global/pwa-install-banner'
const SIGNUP = 'components/infrastructure/fan/web/global/signup-prompt-banner'
const UI = 'components/infrastructure/fan/web/global/ui-primitives'

type Language = 'ja' | 'en'

const WIDTHS = [320, 360, 375, 412]
const LANGUAGES: Language[] = ['ja', 'en']

interface Banner {
	surface: string
	message: string
	action: string
}

const INSTALL_BANNER: Banner = {
	surface: '.pwa-banner',
	message: '.pwa-banner-label',
	action: '.pwa-banner-action',
}

const SIGNUP_BANNER: Banner = {
	surface: '.signup-banner',
	message: '.signup-banner-message',
	action: '.signup-banner-action',
}

/** A signed-in fan who has not installed the app, on Tickets (no FAB). */
async function openInstallBanner(page: Page, language: Language) {
	await seedSignedInFan(page, { installBanner: true, language })
	await openShell(page, '/tickets')
	await expect(page.locator(INSTALL_BANNER.surface)).toBeVisible()
}

/** A guest after onboarding with no follows, on My Artists. */
async function openSignupBanner(page: Page, language: Language) {
	await page.addInitScript((language) => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('onboarding.helpSeen:my-artists', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('guest.followedArtists', '[]')
		localStorage.setItem('language', language)
	}, language)
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await openShell(page, '/my-artists')
	await expect(page.locator(SIGNUP_BANNER.surface)).toBeVisible()
}

/**
 * Each of the message and the button label fits on one line with nothing
 * clipped, side by side, at one text size between 12px and 16px.
 */
async function expectFitsOneLine(page: Page, banner: Banner) {
	// Measured once the web fonts are in: the button label's fallback font is
	// wider than Outfit.
	await page.evaluate(() => document.fonts.ready)
	const fit = await page.evaluate(({ message, action }) => {
		const read = (selector: string) => {
			const el = document.querySelector<HTMLElement>(selector)
			if (!el) throw new Error(`no ${selector}`)
			const rect = el.getBoundingClientRect()
			const range = document.createRange()
			range.selectNodeContents(el)
			return {
				clipped: el.scrollWidth > el.clientWidth,
				lines: new Set(
					[...range.getClientRects()].map((r) => Math.round(r.top)),
				).size,
				fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
				left: rect.left,
				right: rect.right,
				middle: rect.top + rect.height / 2,
			}
		}
		return { message: read(message), action: read(action) }
	}, banner)
	for (const part of [fit.message, fit.action]) {
		expect(part.clipped).toBe(false)
		expect(part.lines).toBe(1)
	}
	expect(fit.action.left).toBeGreaterThanOrEqual(fit.message.right)
	expect(fit.action.middle).toBeCloseTo(fit.message.middle, 0)
	expect(fit.action.fontSize).toBe(fit.message.fontSize)
	expect(fit.message.fontSize).toBeGreaterThanOrEqual(12)
	expect(fit.message.fontSize).toBeLessThanOrEqual(16)
}

for (const width of WIDTHS) {
	for (const language of LANGUAGES) {
		test.describe(`at ${width}px in ${language}`, () => {
			test.use({ viewport: { width, height: 780 } })

			test(`@spec ${INSTALL} "Message and button fit one line" (${width}px, ${language})`, async ({
				page,
			}) => {
				await openInstallBanner(page, language)
				await expectFitsOneLine(page, INSTALL_BANNER)
			})

			test(`@spec ${SIGNUP} "Message and button fit one line" (${width}px, ${language})`, async ({
				page,
			}) => {
				await openSignupBanner(page, language)
				await expectFitsOneLine(page, SIGNUP_BANNER)
			})
		})
	}
}

test.describe('copy', () => {
	test.use({ viewport: { width: 375, height: 780 } })

	test(`@spec ${SIGNUP} "Banner copy — Japanese"`, async ({ page }) => {
		await openSignupBanner(page, 'ja')
		await expect(page.locator(SIGNUP_BANNER.message)).toHaveText(
			'フォロー履歴を保存しよう！',
		)
		await expect(page.locator(SIGNUP_BANNER.action)).toHaveText('Sign Up')
	})

	test(`@spec ${SIGNUP} "Banner copy — English"`, async ({ page }) => {
		await openSignupBanner(page, 'en')
		await expect(page.locator(SIGNUP_BANNER.message)).toHaveText(
			'Save your follows!',
		)
		await expect(page.locator(SIGNUP_BANNER.action)).toHaveText('Sign Up')
	})

	test(`@spec ${INSTALL} "PWA install prompt displays localized text" (en)`, async ({
		page,
	}) => {
		await openInstallBanner(page, 'en')
		await expect(page.locator(INSTALL_BANNER.message)).toHaveText(
			'Get new show alerts!',
		)
		await expect(page.locator(INSTALL_BANNER.action)).toHaveText('Install')
	})
})

test.describe('the install banner cue on each route', () => {
	test.use({ viewport: { width: 375, height: 780 } })

	/** Current times of the banner's cue animations. */
	const cueTimes = (page: Page) =>
		page.locator(INSTALL_BANNER.surface).evaluate((el) =>
			el
				.getAnimations({ subtree: true })
				.filter((a) => (a as CSSAnimation).animationName === 'banner-cue')
				.map((a) => Number(a.currentTime)),
		)

	test(`@spec ${INSTALL} "CTA attention cue" (restarts on another route)`, async ({
		page,
	}) => {
		await openInstallBanner(page, 'ja')
		const cue = await cueTimes(page)
		// The line's and the button's cue.
		expect(cue).toHaveLength(2)

		// Run the cue well into its plays, then open another tab.
		await page.locator(INSTALL_BANNER.surface).evaluate((el) => {
			for (const a of el.getAnimations({ subtree: true })) {
				if ((a as CSSAnimation).animationName === 'banner-cue')
					a.currentTime = 50_000
			}
		})
		await tapTab(page, 'my-artists')
		await page.waitForURL('**/my-artists')

		for (const time of await cueTimes(page)) {
			expect(time).toBeLessThan(5_000)
		}
	})
})

test.describe('the snack bar action', () => {
	test.use({ viewport: { width: 375, height: 780 } })

	test(`@spec ${UI} "Button on a coloured surface"`, async ({ page }) => {
		await openInstallBanner(page, 'ja')
		await page.waitForFunction(
			() =>
				typeof (window as unknown as Record<string, unknown>)
					.__lm_publishSnack === 'function',
		)
		await page.evaluate(() => {
			const publish = (window as unknown as Record<string, unknown>)
				.__lm_publishSnack as (
				m: string,
				s: string,
				d: number,
				o: object,
			) => void
			publish('新しいバージョンがあります', 'info', 60_000, {
				actionLabel: '更新',
			})
		})
		const action = page.locator('.snack-item:popover-open .snack-action-btn')
		await expect(action).toHaveAttribute('data-variant', 'on-container')
		const border = await action.evaluate((el) =>
			Number.parseFloat(getComputedStyle(el).borderTopWidth),
		)
		expect(border).toBeGreaterThanOrEqual(1.5)
		// The banner's own action stays the filled button.
		await expect(page.locator(INSTALL_BANNER.action)).not.toHaveAttribute(
			'data-variant',
		)
	})
})
