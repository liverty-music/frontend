import { expect, type Page, test } from '../support/test'
import { frames, openDashboard, scrollBy } from '../support/timetable'

/**
 * The deal-in of the timetable's concert cards on the dashboard. Chromium starts
 * it from a scroll trigger, time-based; WebKit (`webkit-shell`), which has no
 * scroll-triggered animations, ties the same motion to the scroll.
 */

const HIGHWAY = 'components/infrastructure/fan/web/global/live-highway'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 800 } })

interface CardMotion {
	/** The card's lane (0 HOME, 1 NEAR, 2 AWAY) and its place in the lane. */
	lane: number
	index: number
	/** Deal-in animations on the card. */
	count: number
	delay: number
	duration: number
	currentTime: number
	playState: string
	/** Deal-in animations on anything in the row that is not a card. */
	others: number
}

/**
 * The deal-in animations of the first row wholly inside the timetable's
 * scroll area, one entry per concert card, and that row's date.
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
		const all = row
			.getAnimations({ subtree: true })
			.filter((a) => (a as CSSAnimation).animationName === 'deal-in')
		const others = all.filter(
			(a) =>
				(a.effect as KeyframeEffect).target?.localName !== 'event-card' ||
				(a.effect as KeyframeEffect).pseudoElement !== null,
		).length
		const cards = [...row.querySelectorAll<HTMLElement>('.lane')].flatMap(
			(lane, laneAt) =>
				[...lane.querySelectorAll<HTMLElement>('event-card')].map(
					(card, index) => {
						const mine = all.filter(
							(a) => (a.effect as KeyframeEffect).target === card,
						)
						const a = mine[0]
						return {
							lane: laneAt,
							index,
							count: mine.length,
							delay: Math.round(Number(a?.effect?.getTiming().delay ?? 0)),
							duration: Number(a?.effect?.getComputedTiming().duration ?? 0),
							currentTime: Number(a?.currentTime ?? 0),
							playState: a?.playState ?? 'none',
							others,
						}
					},
				),
		)
		return { key: row.dataset.dateKey ?? '', cards }
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

/**
 * A row that has just been dealt in: only its concert cards move, each
 * running, early in its run, 100 ms after the card above it in its lane and
 * 100 ms per lane (HOME, NEAR, AWAY).
 */
function expectDealing(cards: CardMotion[]): void {
	expect(cards.length).toBeGreaterThan(0)
	for (const card of cards) {
		expect(card.others).toBe(0)
		expect(card.count).toBe(1)
		expect(card.delay).toBe((card.lane + card.index) * 100)
		expect(card.duration).toBe(800)
		expect(card.playState).toBe('running')
		// Early in its run: before the end of its delay and 800 ms.
		expect(card.currentTime).toBeLessThan(card.delay + 800)
	}
}

test.describe('deal-in, scroll-triggered (Chromium)', () => {
	test.skip(({ browserName }) => browserName !== 'chromium')

	test(`@spec ${HIGHWAY} "Fast scroll"`, async ({ page }) => {
		await openDashboard(page)
		// 1500 px in one frame: rows cross into view far faster than 100 ms.
		await scrollBy(page, 1500)
		const first = await rowInView(page)
		if (!first) throw new Error('no row in view')
		expectDealing(first.cards)

		// With no further scrolling, it runs on: its pace is time, not scroll.
		await expect
			.poll(async () => (await rowInView(page))?.cards[0].currentTime ?? 0)
			.toBeGreaterThan(300)
		const later = await rowInView(page)
		expect(later?.key).toBe(first.key)
		expect(later?.cards[0].playState).toBe('running')
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
		expectDealing(row.cards)
	})

	test(`@spec ${HIGHWAY} "A row comes back"`, async ({ page }) => {
		await openDashboard(page)
		await scrollBy(page, 1500)
		const row = await rowInView(page)
		if (!row) throw new Error('no row in view')
		await expect
			.poll(async () => (await rowInView(page))?.cards[0].playState)
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
		expectDealing(again?.cards ?? [])
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

		/** The row's first card's opacity and the row's top, relative to the list. */
		const state = () =>
			page.evaluate((key) => {
				const scroll = document.querySelector(
					'concert-highway .concert-scroll',
				) as HTMLElement
				const g = [...scroll.querySelectorAll<HTMLElement>('.date-group')].find(
					(n) => n.dataset.dateKey === key,
				) as HTMLElement
				const card = g.querySelector('event-card') as HTMLElement
				return {
					opacity: Number(getComputedStyle(card).opacity),
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
