import { expect, type Page, test } from '../support/test'
import { frames, openDashboard, scrollBy } from '../support/timetable'

/**
 * The deal-in of the timetable's date rows on the dashboard. Chromium starts
 * it from a scroll trigger, time-based; WebKit (`webkit-shell`), which has no
 * scroll-triggered animations, ties the same motion to the scroll.
 */

const HIGHWAY = 'components/infrastructure/fan/web/global/live-highway'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 800 } })

interface LaneMotion {
	delay: number
	duration: number
	currentTime: number
	playState: string
}

/**
 * The deal-in animations of the first row wholly inside the timetable's
 * scroll area, per lane (HOME, NEAR, AWAY), and that row's date.
 */
function rowInView(page: Page) {
	return page.evaluate(() => {
		const scroll = document.querySelector(
			'concert-highway .concert-scroll',
		) as HTMLElement
		const box = scroll.getBoundingClientRect()
		const row = [
			...scroll.querySelectorAll<HTMLElement>('.date-group[data-date-key]'),
		].find((g) => {
			const r = g.getBoundingClientRect()
			return r.top >= box.top && r.bottom <= box.bottom
		})
		if (!row) return null
		const lanes = [...row.querySelectorAll<HTMLElement>('.lane')].map((lane) =>
			lane
				.getAnimations()
				.filter((a) => (a as CSSAnimation).animationName === 'deal-in')
				.map((a) => ({
					delay: Number(a.effect?.getTiming().delay ?? 0),
					duration: Number(a.effect?.getComputedTiming().duration ?? 0),
					currentTime: Number(a.currentTime ?? 0),
					playState: a.playState,
				})),
		)
		return { key: row.dataset.dateKey ?? '', lanes }
	})
}

/** Wait until the timetable's scroll has stopped (no `scrollend` for 300 ms). */
function settled(page: Page): Promise<void> {
	return page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				const scroll = document.querySelector(
					'concert-highway .concert-scroll',
				) as HTMLElement
				let timer = setTimeout(done, 300)
				function done() {
					scroll.removeEventListener('scrollend', again)
					resolve()
				}
				function again() {
					clearTimeout(timer)
					timer = setTimeout(done, 300)
				}
				scroll.addEventListener('scrollend', again)
			}),
	)
}

/** A row that has just been dealt in: every lane running, early in its run. */
function expectDealing(lanes: LaneMotion[][]): void {
	expect(lanes.map((l) => l.length)).toEqual([1, 1, 1])
	// HOME, then NEAR 100 ms and AWAY 200 ms later.
	expect(lanes.map((l) => l[0].delay)).toEqual([0, 100, 200])
	for (const [motion] of lanes) {
		expect(motion.duration).toBe(800)
		expect(motion.playState).toBe('running')
		// Early in its run: before the end of its delay and 800 ms.
		expect(motion.currentTime).toBeLessThan(motion.delay + 800)
	}
}

test.describe('deal-in, scroll-triggered (Chromium)', () => {
	test.skip(({ browserName }) => browserName !== 'chromium')

	test(`@spec ${HIGHWAY} "Scrolling down"`, async ({ page }) => {
		await openDashboard(page)
		await scrollBy(page, 1500)
		const row = await rowInView(page)
		if (!row) throw new Error('no row in view')
		expectDealing(row.lanes)
	})

	test(`@spec ${HIGHWAY} "Fast scroll"`, async ({ page }) => {
		await openDashboard(page)
		// 1500 px in one frame: rows cross into view far faster than 100 ms.
		await scrollBy(page, 1500)
		const first = await rowInView(page)
		if (!first) throw new Error('no row in view')
		expectDealing(first.lanes)

		// With no further scrolling, it runs on: its pace is time, not scroll.
		await expect
			.poll(async () => (await rowInView(page))?.lanes[2][0].currentTime ?? 0)
			.toBeGreaterThan(300)
		const later = await rowInView(page)
		expect(later?.key).toBe(first.key)
		expect(later?.lanes[2][0].playState).toBe('running')
	})

	test(`@spec ${HIGHWAY} "Scrolling up after a month jump"`, async ({
		page,
	}) => {
		await openDashboard(page)
		await scrollBy(page, 120)
		await page
			.locator('concert-highway .month-jump-button[data-direction="next"]')
			.click()
		// The jump has landed once its target month is at the top.
		await expect(
			page.locator('concert-highway .month-jump-button[data-direction="prev"]'),
		).toBeVisible()
		await settled(page)

		// Upward: rows come in at the top edge, built by the upward growth.
		const before = await rowInView(page)
		await scrollBy(page, -500)
		const row = await rowInView(page)
		if (!row || !before) throw new Error('no row in view')
		expect(row.key < before.key).toBe(true)
		expectDealing(row.lanes)
	})

	test(`@spec ${HIGHWAY} "A row comes back"`, async ({ page }) => {
		await openDashboard(page)
		await scrollBy(page, 1500)
		const row = await rowInView(page)
		if (!row) throw new Error('no row in view')
		await expect
			.poll(async () => (await rowInView(page))?.lanes[2][0].playState)
			.toBe('finished')

		// Fully out of view, then back to the same place: dealt in again.
		const scrollTop = () =>
			page.evaluate(
				() =>
					(
						document.querySelector(
							'concert-highway .concert-scroll',
						) as HTMLElement
					).scrollTop,
			)
		const place = await scrollTop()
		await scrollBy(page, 2000)
		await scrollBy(page, place - (await scrollTop()))
		const again = await rowInView(page)
		expect(again?.key).toBe(row.key)
		expectDealing(again?.lanes ?? [])
	})
})

test.describe('deal-in, scroll-linked (no scroll triggers)', () => {
	test(`@spec ${HIGHWAY} "Leaving through the top without entry-triggered animations"`, async ({
		page,
	}) => {
		await openDashboard(page)
		test.skip(
			await page.evaluate(() => CSS.supports('timeline-trigger: --t view()')),
			'this browser has scroll-triggered animations',
		)
		await scrollBy(page, 600)
		const row = await rowInView(page)
		if (!row) throw new Error('no row in view')

		/** The HOME lane's opacity and the row's top, relative to the list. */
		const state = () =>
			page.evaluate((key) => {
				const scroll = document.querySelector(
					'concert-highway .concert-scroll',
				) as HTMLElement
				const g = [...scroll.querySelectorAll<HTMLElement>('.date-group')].find(
					(n) => n.dataset.dateKey === key,
				) as HTMLElement
				const lane = g.querySelector('.lane') as HTMLElement
				return {
					opacity: Number(getComputedStyle(lane).opacity),
					top:
						g.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
					height: g.getBoundingClientRect().height,
				}
			}, row.key)

		// In view, it is dealt in.
		expect((await state()).opacity).toBe(1)

		// Down until well over 40% of it has left through the top: it deals out.
		const { top, height } = await state()
		await scrollBy(page, top + height * 0.8)
		await frames(page)
		expect((await state()).opacity).toBeLessThan(1)

		// Back up until it is in view again: dealt in from the top.
		await scrollBy(page, -(height * 0.8 + 40))
		await frames(page)
		expect((await state()).opacity).toBe(1)
	})
})
