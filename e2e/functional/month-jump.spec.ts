import { expect, type Page, test } from '../support/test'
import { openDashboard } from '../support/timetable'

/**
 * The month-jump capsule's first display in a browser that cannot tell
 * whether a list has been scrolled (WebKit). The rest of the month jump is
 * checked by the `concert-highway` stories.
 */

const DASHBOARD = 'components/infrastructure/fan/web/route/dashboard'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 800 } })

const jump = (page: Page, direction: 'prev' | 'next') =>
	page.locator(
		`concert-highway .month-jump-button[data-direction="${direction}"]`,
	)

test.describe('month jump', () => {
	test(`@spec ${DASHBOARD} "First display in a browser that cannot tell whether a list has been scrolled"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openDashboard(page)
		test.skip(
			await page.evaluate(() => CSS.supports('container-type: scroll-state')),
			'this browser can tell whether a list has been scrolled',
		)
		// Unscrolled, at the first loaded date: the capsule shows from the
		// loaded months alone.
		await expect(jump(page, 'next')).toBeVisible()
		await expect(jump(page, 'prev')).toBeHidden()
	})
})
