import { expect, type Page, test } from '../support/test'
import {
	dateKey,
	frames,
	OFFSETS,
	openDashboard,
	scrollBy,
	topDate,
} from '../support/timetable'

/**
 * The timetable's month-jump buttons on the dashboard, against a mocked
 * concert list that spans more than three months: when the capsule shows,
 * that it gives way to the FAB, and that a jump under reduced motion lands
 * without scrolling there and adds no history entry.
 */

const DASHBOARD = 'components/infrastructure/fan/web/route/dashboard'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 800 } })

const jump = (page: Page, direction: 'prev' | 'next') =>
	page.locator(
		`concert-highway .month-jump-button[data-direction="${direction}"]`,
	)

/** The first loaded date in the month after the given date's month. */
function firstOfNextMonth(after: string): string {
	const month = after.slice(0, 7)
	const next = OFFSETS.map(dateKey).find((k) => k.slice(0, 7) > month)
	if (!next) throw new Error('no later month in the fixture')
	return next
}

test.describe('month jump', () => {
	test(`@spec ${DASHBOARD} "Not shown before the fan scrolls"`, async ({
		page,
	}) => {
		await openDashboard(page)
		test.skip(
			!(await page.evaluate(() =>
				CSS.supports('container-type: scroll-state'),
			)),
			'this browser cannot tell whether a list has been scrolled',
		)
		await expect(jump(page, 'next')).toBeHidden()
		await expect(jump(page, 'prev')).toBeHidden()

		await scrollBy(page, 120)
		await expect(jump(page, 'next')).toBeVisible()
	})

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

	test(`@spec ${DASHBOARD} "Hidden while the FAB is open"`, async ({
		page,
	}) => {
		await openDashboard(page)
		await scrollBy(page, 120)
		await expect(jump(page, 'next')).toBeVisible()

		const fab = page.locator('fab-menu .fab-toggle')
		await fab.click()
		await expect(fab).toHaveAttribute('aria-expanded', 'true')
		await expect(jump(page, 'next')).toBeHidden()

		await fab.click()
		await expect(fab).toHaveAttribute('aria-expanded', 'false')
		await expect(jump(page, 'next')).toBeVisible()
	})

	test(`@spec ${DASHBOARD} "Reduced motion"`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await openDashboard(page)
		await scrollBy(page, 120)
		const from = await topDate(page)
		if (!from) throw new Error('no date at the top')
		const target = firstOfNextMonth(from)
		const history = await page.evaluate(() => history.length)
		const url = page.url()

		await jump(page, 'next').click()
		// One frame later the target is already at the top: no scrolling there.
		await frames(page, 1)
		expect(await topDate(page)).toBe(target)

		// The jump adds no history entry and leaves the address alone, so the
		// back action still leaves the dashboard.
		expect(await page.evaluate(() => history.length)).toBe(history)
		expect(page.url()).toBe(url)
	})

	test('a jump scrolls smoothly to the next month and back', async ({
		page,
	}) => {
		await openDashboard(page)
		await scrollBy(page, 120)
		const from = await topDate(page)
		if (!from) throw new Error('no date at the top')
		const target = firstOfNextMonth(from)
		const history = await page.evaluate(() => history.length)

		await jump(page, 'next').click()
		await expect.poll(() => topDate(page)).toBe(target)
		await expect(jump(page, 'prev')).toBeVisible()

		await jump(page, 'prev').click()
		const firstOfFrom = OFFSETS.map(dateKey).find(
			(k) => k.slice(0, 7) === from.slice(0, 7),
		)
		await expect.poll(() => topDate(page)).toBe(firstOfFrom)
		// The fan can go forward again from there.
		await expect(jump(page, 'next')).toBeVisible()
		expect(await page.evaluate(() => history.length)).toBe(history)
	})
})
