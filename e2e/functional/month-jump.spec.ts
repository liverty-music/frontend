import { expect, type Page, test } from '../support/test'
import { openTimetable } from '../support/timetable'

/**
 * The month-jump capsule's first display in a browser that cannot tell
 * whether a list has been scrolled (WebKit). The rest of the month jump is
 * checked by the `timetable-grid` stories.
 */

const TIMETABLE = 'components/infrastructure/fan/web/route/timetable'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 800 } })

const jump = (page: Page, direction: 'prev' | 'next') =>
	page.locator(
		`timetable-grid .month-jump-button[data-direction="${direction}"]`,
	)

test.describe('month jump', () => {
	test(`@spec ${TIMETABLE} "First display in a browser that cannot tell whether a list has been scrolled"`, {
		tag: '@webkit',
	}, async ({ page }) => {
		await openTimetable(page)
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
