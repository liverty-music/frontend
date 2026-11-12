import { openShell, seedSignedInFan, tapTab } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The install banner's attention cue starting again on each route, on a real
 * screen. The banners' one-row fit at every phone width, their copy and the
 * snack action's variant are checked in stories.
 */

const INSTALL = 'components/infrastructure/fan/web/global/pwa-install-banner'

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
