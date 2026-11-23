import { fakeId } from '../support/fake-id'
import { fab, openShell } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * Help's 「チュートリアル」 in the real app: it closes the help sheet and shows
 * the page's guide moment again, even one this device has already seen.
 */

const GUIDE = 'components/infrastructure/fan/web/global/guide-moment'
const A = { id: fakeId('replay-artist-a'), name: 'Artist A', mbid: '' }

async function openMyArtists(page: Page): Promise<void> {
	await page.addInitScript((artist) => {
		if (sessionStorage.getItem('__seeded')) return
		sessionStorage.setItem('__seeded', '1')
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('language', 'ja')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([{ artist, hype: 'nearby' }]),
		)
		// This device has seen the moment: only the replay can show it.
		localStorage.setItem('guide.seen:myArtists.hype', '1')
	}, A)
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
	await openShell(page, '/my-artists')
	await expect(page.locator('[data-artist-rows] .artist-row')).toHaveCount(1, {
		timeout: 20_000,
	})
}

test(`@spec ${GUIDE} "Replay the hype moment"`, async ({ page }) => {
	await openMyArtists(page)
	// Seen already: nothing is lit on arrival.
	await expect(page.locator('[data-guide-active]')).toHaveCount(0)

	await fab(page).click()
	await expect(fab(page)).toHaveAttribute('aria-expanded', 'true')
	await page.locator('action-menu .fab-item[data-action-id="help"]').click()
	const replay = page.getByTestId('help-replay-hype')
	await expect(replay).toBeVisible()
	await replay.click()

	// The sheet closes and the hype dots light up with the guide line.
	await expect(page.locator('page-help .sheet-body')).toBeHidden()
	await expect(page.locator('[data-guide-active="dots"]')).toBeVisible()
	await expect(page.locator('guide-line')).toContainText('Hype（熱量）')
})
