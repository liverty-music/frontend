import { openShell, seedSignedInFan, tapTab } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The persistent bottom banners on real screens: the install banner's cue
 * starting again on each route, and the snack's action keeping the
 * on-container variant (the banners take the filled one). The banners' one-row
 * fit at every phone width and their copy are stories
 * (`FitsOneLineAtEveryPhoneWidth`).
 */

const INSTALL = 'components/infrastructure/fan/web/global/pwa-install-banner'
const UI = 'components/infrastructure/fan/web/global/ui-primitives'

type Language = 'ja' | 'en'

interface Banner {
	surface: string
	message: string
	action: string
}

const INSTALL_BANNER: Banner = {
	surface: 'pwa-install-banner .bottom-banner',
	message: 'pwa-install-banner .bottom-banner-message',
	action: 'pwa-install-banner .bottom-banner-action',
}

/** A signed-in fan who has not installed the app, on Tickets (no FAB). */
async function openInstallBanner(page: Page, language: Language) {
	await seedSignedInFan(page, { installBanner: true, language })
	await openShell(page, '/tickets')
	await expect(page.locator(INSTALL_BANNER.surface)).toBeVisible()
}

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
