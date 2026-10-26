import { expect, test } from '@playwright/test'
import { optOutOfAnalytics } from './onboarding'

/**
 * Story `complete-onboarding`, as a guest who has never used the app, against
 * production: Welcome → Discovery until the timetable is ready → Timetable →
 * home area → celebration → completed.
 *
 * Follows real artists found by search, so it needs no test data. The three
 * artists were picked because each has upcoming concerts; if one stops
 * having any, the progress row never becomes ready and the spec says so.
 */
const ARTISTS = ['King Gnu', 'Official髭男dism', 'Mrs. GREEN APPLE']

test.describe('complete onboarding (guest)', () => {
	test('a new guest builds a timetable, chooses a home area and completes onboarding', async ({
		page,
	}) => {
		// @spec stories/complete-onboarding "Brand-new user defaults to onboarding"
		// @spec stories/complete-onboarding "Completion latches after choosing the home area on arrival"
		test.setTimeout(180_000)
		await optOutOfAnalytics(page)

		await page.goto('/?lang=ja')
		expect(
			await page.evaluate(() => localStorage.getItem('onboardingComplete')),
		).not.toBe('true')
		await page.getByTestId('welcome-get-started').first().click()
		await expect(page).toHaveURL(/\/discovery/)

		// A new guest gets the page help on first arrival; close it as a fan
		// would before searching.
		const help = page.getByRole('dialog', { name: 'ページのヘルプ' })
		await expect(help).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(help).toBeHidden()

		// Each follow fills the progress row; the row turns into the link to
		// the timetable once the follows' concerts are found.
		const search = page.locator('.search-input')
		for (const name of ARTISTS) {
			await search.click()
			await search.fill('')
			await search.pressSequentially(name, { delay: 40 })
			await page.locator('.result-item').first().click({ timeout: 30_000 })
			if (await page.locator('.clear-button').count()) {
				await page.locator('.clear-button').click()
			}
		}
		const ready = page.locator('onboarding-progress').getByRole('link')
		await expect(ready).toBeVisible({ timeout: 60_000 })
		await expect(ready).toContainText('完成しました！')

		await ready.click()
		await expect(page).toHaveURL(/\/dashboard/)

		// No home area yet: the Timetable asks for one first.
		await page.getByRole('button', { name: '東京', exact: true }).click()

		const overlay = page.locator('.celebration-overlay[data-state="active"]')
		await expect(overlay).toBeVisible({ timeout: 30_000 })
		await expect(overlay).toContainText(
			/3組のアーティストの[1-9]\d*公演が見つかりました/,
		)
		await expect
			.poll(() =>
				page.evaluate(() => localStorage.getItem('onboardingComplete')),
			)
			.toBe('true')

		// Tapping dismisses the celebration and leaves the timetable usable.
		await overlay.click()
		await expect(overlay).toBeHidden()
	})
})
