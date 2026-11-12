import { expect, type Page, test } from '../support/test'
import { frames, openDashboard, scrollBy } from '../support/timetable'

/**
 * The deal-in of the timetable's concert cards on the dashboard, in a browser
 * without scroll-triggered animations (WebKit, `webkit-shell`), where the same
 * motion is tied to the scroll. Chromium's scroll-triggered deal-in is checked
 * by the `DealInWhenRowsArrive` story of `concert-highway`.
 */

const HIGHWAY = 'components/infrastructure/fan/web/global/live-highway'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 800 } })

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

test.describe('deal-in, scroll-linked (no scroll triggers)', () => {
	test(`@spec ${HIGHWAY} "Leaving through the top without entry-triggered animations"`, {
		tag: '@webkit',
	}, async ({ page }) => {
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
