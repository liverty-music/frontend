import { existsSync, readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { optOutOfAnalytics } from './onboarding'
import { FAN_STATE, test } from './session'

/**
 * Story `complete-onboarding`, the sign-up payoff, against production: the
 * full celebration, then the post-signup sheet's notification step and
 * install step.
 *
 * A real sign-up would leave a new production account behind on every run,
 * so the spec signs in as the prod E2E test user and schedules the payoff the
 * way the auth callback does after a sign-up (`postSignup.shown=pending`).
 * The callback's own decision is covered by the auth-callback unit tests.
 *
 * Runs in Chromium's new headless mode: the default headless shell reports
 * notification permission as already blocked, which would skip the
 * notification step.
 */
test.use({ channel: 'chromium' })

type Catalog = typeof import('../../src/locales/ja/translation.json')
const catalog = (lang: 'ja' | 'en'): Catalog =>
	JSON.parse(readFileSync(`src/locales/${lang}/translation.json`, 'utf8'))

test.describe('complete onboarding (sign-up payoff)', () => {
	test.beforeAll(() => {
		if (!existsSync(FAN_STATE)) {
			throw new Error(
				`${FAN_STATE} is missing: run npm run auth:capture:password:prod`,
			)
		}
	})

	// The session file is shared with the other signed-in specs and is written
	// back even when this test fails: never leave the payoff scheduled in it.
	test.afterEach(async ({ page }) => {
		await page
			.evaluate(() => localStorage.removeItem('postSignup.shown'))
			.catch(() => {})
	})

	test('the celebration leads to the notification step, then the install step', async ({
		page,
	}) => {
		test.setTimeout(180_000)
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Post-signup full celebration then dialog"
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Both steps in order"
		await optOutOfAnalytics(page)

		// The sheet counts the artists the fan follows, as My Artists lists them.
		await page.goto('/my-artists')
		const rows = page.locator('.artist-row-name')
		await expect(rows.first()).toBeVisible({ timeout: 30_000 })
		const followed = await rows.count()
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).toBe('true')

		// The test user's account language decides the copy.
		const copy = (await page.evaluate(() => document.documentElement.lang))
			.toLowerCase()
			.startsWith('ja')
			? catalog('ja')
			: catalog('en')
		await page.evaluate(() =>
			localStorage.setItem('postSignup.shown', 'pending'),
		)
		await page.goto('/dashboard')

		// The home-area choice precedes the payoff. The test user keeps the
		// area from its first run, so later runs go straight to the payoff.
		const tokyo = page.getByRole('button', {
			name: copy.userHome.cities.tokyo,
			exact: true,
		})
		const overlay = page.locator('.celebration-overlay[data-state="active"]')
		await expect(tokyo.or(overlay).first()).toBeVisible({ timeout: 30_000 })
		if (await tokyo.isVisible()) await tokyo.click()

		await expect(overlay).toBeVisible({ timeout: 30_000 })
		await expect(overlay).toContainText(
			copy.dashboard.celebration.welcome.split('\n')[0],
		)
		await expect(overlay.locator('.confetti')).not.toHaveCount(0)
		await overlay.click()

		const notify = page.locator('.post-signup-step[data-step="notify"]')
		await expect(notify).toBeVisible({ timeout: 10_000 })
		await expect(notify).toContainText(copy.postSignup.notify.title)
		await expect(notify).toContainText(
			copy.postSignup.notify.body.replace('{{count}}', String(followed)),
		)
		await expect(
			notify.getByRole('button', { name: copy.postSignup.notify.enable }),
		).toBeVisible()
		await notify.getByRole('button', { name: copy.postSignup.defer }).click()

		const install = page.locator('.post-signup-step[data-step="install"]')
		await expect(install).toBeVisible()
		await expect(install).toContainText(copy.postSignup.install.title)
		await expect(
			install.getByRole('button', { name: copy.postSignup.install.add }),
		).toBeVisible()
		await install.getByRole('button', { name: copy.postSignup.defer }).click()
		await expect(install).toBeHidden()

		// The payoff is shown once.
		await page.reload()
		await expect(page.locator('au-viewport')).toBeVisible()
		await expect(overlay).toHaveCount(0)
	})
})
