import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakeElement),
		bindable: actual.bindable,
		observable: actual.observable,
	}
})

import type { Concert, DateGroup } from '../../entities/concert'
import { ConcertHighway, JUMP_SETTLE_MS } from './concert-highway'

const fakeElement = {
	querySelector: vi.fn((): unknown => null),
	querySelectorAll: vi.fn((_selector: string): unknown[] => []),
	style: { setProperty: vi.fn() },
}

function makeConcert(overrides: Partial<Concert>): Concert {
	return {
		id: 'e1',
		artistName: 'Artist',
		artistId: 'a1',
		venueName: 'Venue',
		locationLabel: 'Tokyo',
		date: new Date('2026-04-01'),
		startTime: '18:00',
		title: 'Live',
		sourceUrl: '',
		isFirstParty: false,
		hypeLevel: 'home',
		matched: true,
		artistHue: 0,
		...overrides,
	}
}

describe('ConcertHighway', () => {
	let sut: ConcertHighway

	beforeEach(() => {
		vi.clearAllMocks()
		fakeElement.querySelector.mockReturnValue(null)
		fakeElement.querySelectorAll.mockReturnValue([])
		sut = new ConcertHighway()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('dateGroups bindable', () => {
		it('defaults to empty array', () => {
			expect(sut.dateGroups).toEqual([])
		})

		it('accepts date groups', () => {
			const groups: DateGroup[] = [
				{
					label: '2026-04-01',
					dateKey: '2026-04-01',
					isFirstOfMonth: false,
					monthSeparatorLabel: '',
					home: [],
					nearby: [],
					away: [],
				},
			]
			sut.dateGroups = groups

			expect(sut.dateGroups).toHaveLength(1)
		})
	})

	describe('isReadonly bindable', () => {
		it('defaults to false', () => {
			expect(sut.isReadonly).toBe(false)
		})
	})

	describe('scrollAnchor', () => {
		function group(dateKey: string, top: number, bottom: number) {
			return {
				dataset: { dateKey },
				getBoundingClientRect: () => ({ top, bottom }),
				scrollIntoView: vi.fn(),
			}
		}

		function withScroller(
			scroller: { scrollTop: number } | null,
			top = 100,
			groups: ReturnType<typeof group>[] = [],
		) {
			const el = scroller && {
				...scroller,
				getBoundingClientRect: () => ({ top }),
				querySelectorAll: () => groups,
				scrollBy(this: { scrollTop: number }, { top }: { top: number }) {
					this.scrollTop += top
				},
			}
			fakeElement.querySelector.mockImplementation(((sel: string) =>
				sel === '.concert-scroll' ? el : null) as never)
			return el
		}

		it('names the group at the top edge and how far into it', () => {
			withScroller({ scrollTop: 0 }, 100, [
				// Scrolled past: its bottom is above the edge.
				group('2026-07-15', -300, 40),
				// The one the fan is looking at, 60px in.
				group('2026-07-18', 40, 500),
				group('2026-07-20', 500, 900),
			])

			expect(sut.scrollAnchor).toEqual({ dateKey: '2026-07-18', offset: 60 })
		})

		it('restores by scrolling the named group into view, not by arithmetic', () => {
			// The browser resolves where the group is; only then is the fan's offset
			// into it applied.
			const target = group('2026-07-18', 4000, 4400)
			const scroller = withScroller({ scrollTop: 0 }, 100, [target])

			sut.scrollAnchor = { dateKey: '2026-07-18', offset: 60 }

			// Instant: the list scrolls smoothly by its stylesheet, but a restore
			// must not animate, or the offset would add to a part-way position.
			expect(target.scrollIntoView).toHaveBeenCalledWith({
				block: 'start',
				inline: 'nearest',
				behavior: 'instant',
			})
			expect(scroller?.scrollTop).toBe(60)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "The anchored date is gone"
		it('lands on the nearest later date when the anchored date is gone', () => {
			// A background refresh can drop a date that has since passed. The fan
			// lands on the next date that remains, not at the top — and without the
			// offset, which was measured into the date that is gone.
			const earlier = group('2026-07-15', -300, 40)
			const later = group('2026-07-20', 40, 500)
			const scroller = withScroller({ scrollTop: 250 }, 100, [earlier, later])

			sut.scrollAnchor = { dateKey: '2026-07-18', offset: 60 }

			expect(earlier.scrollIntoView).not.toHaveBeenCalled()
			expect(later.scrollIntoView).toHaveBeenCalledWith({
				block: 'start',
				inline: 'nearest',
				behavior: 'instant',
			})
			expect(scroller?.scrollTop).toBe(250)
		})

		it('stays put when no date at or after the anchor remains', () => {
			const only = group('2026-07-15', 40, 500)
			const scroller = withScroller({ scrollTop: 250 }, 100, [only])

			sut.scrollAnchor = { dateKey: '2026-07-18', offset: 60 }

			expect(only.scrollIntoView).not.toHaveBeenCalled()
			expect(scroller?.scrollTop).toBe(250)
		})

		it('is inert before the view is in the DOM', () => {
			withScroller(null)

			expect(sut.scrollAnchor).toBeNull()
			expect(() => {
				sut.scrollAnchor = { dateKey: '2026-07-18', offset: 60 }
			}).not.toThrow()
		})
	})

	describe('month jump', () => {
		const DASHBOARD = 'components/infrastructure/fan/web/route/dashboard'

		/** One date group per day of each given month ("2026-11": 30 days). */
		function months(...spec: [string, number][]): DateGroup[] {
			return spec.flatMap(([month, days]) =>
				Array.from({ length: days }, (_, i) => {
					const dateKey = `${month}-${String(i + 1).padStart(2, '0')}`
					return {
						label: dateKey,
						dateKey,
						isFirstOfMonth: i === 0,
						monthSeparatorLabel: '',
						home: [],
						nearby: [],
						away: [],
					}
				}),
			)
		}

		/**
		 * A scroll container whose built groups are `visibleGroups`, 100px each,
		 * with `top` naming the date at the top edge. Scrolls are recorded in
		 * order: `scrollTo 0 instant`, `into <date> instant`, or
		 * `into <date> css` for a scroll whose motion the stylesheet decides.
		 */
		function mount(sut: ConcertHighway, top: { key: string }) {
			const scrolls: string[] = []
			const node = (dateKey: string, i: number, at: number) => ({
				dataset: { dateKey },
				getBoundingClientRect: () => ({
					top: (i - at) * 100,
					bottom: (i - at) * 100 + 100,
				}),
				scrollIntoView: (o: ScrollIntoViewOptions) => {
					scrolls.push(`into ${dateKey} ${o.behavior ?? 'css'}`)
				},
			})
			const el = {
				scrollTop: 0,
				getBoundingClientRect: () => ({ top: 0 }),
				querySelectorAll: () => {
					const keys = sut.visibleGroups.map((g) => g.dateKey)
					const at = Math.max(0, keys.indexOf(top.key))
					return keys.map((k, i) => node(k, i, at))
				},
				scrollTo: (o: ScrollToOptions) => {
					scrolls.push(`scrollTo ${o.top} ${o.behavior}`)
				},
				scrollBy: () => {},
			}
			fakeElement.querySelector.mockImplementation(((sel: string) =>
				sel === '.concert-scroll' ? el : null) as never)
			return scrolls
		}

		/** Show the window around `key` with `key` at the top edge. */
		function openAt(sut: ConcertHighway, groups: DateGroup[], key: string) {
			sut.dateGroups = groups
			sut.initialAnchor = { dateKey: key, offset: 0 }
			sut.binding()
			const top = { key }
			const scrolls = mount(sut, top)
			sut.attached()
			scrolls.length = 0
			return { top, scrolls }
		}

		const built = (sut: ConcertHighway) =>
			sut.visibleGroups.map((g) => g.dateKey)

		// @spec components/infrastructure/fan/web/route/dashboard "Next month from the middle of November"
		it('moves to the first December date, scrolling down to it, with no history entry', () => {
			const push = vi.spyOn(window.history, 'pushState')
			const replace = vi.spyOn(window.history, 'replaceState')
			const { scrolls } = openAt(
				sut,
				months(['2026-11', 30], ['2026-12', 31]),
				'2026-11-14',
			)

			sut.jumpToMonth(1)

			// The window opens two dates above December's first date, the view
			// is put at its top at once, and the stylesheet animates the short
			// scroll down to the target.
			expect(built(sut)[0]).toBe('2026-11-29')
			expect(built(sut)).toContain('2026-12-01')
			expect(scrolls).toEqual(['scrollTo 0 instant', 'into 2026-12-01 css'])
			expect(push).not.toHaveBeenCalled()
			expect(replace).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Previous month"
		it('moves to the first November date, scrolling up to it', () => {
			const { scrolls } = openAt(
				sut,
				months(['2026-11', 30], ['2026-12', 31]),
				'2026-12-05',
			)

			sut.jumpToMonth(-1)

			// Put two dates below the target first, so the final scroll runs up.
			expect(built(sut)[0]).toBe('2026-11-01')
			expect(scrolls).toEqual([
				'into 2026-11-03 instant',
				'into 2026-11-01 css',
			])
		})

		it('skips a month with no loaded dates', () => {
			const { scrolls } = openAt(
				sut,
				months(['2026-10', 3], ['2026-12', 3]),
				'2026-10-02',
			)
			expect(sut.nextMonth).toEqual(new Date(2026, 11))

			sut.jumpToMonth(1)

			expect(scrolls.at(-1)).toBe('into 2026-12-01 css')
		})

		// @spec components/infrastructure/fan/web/route/dashboard "A month jump builds only around the target month"
		it('builds only a window around the target, however far it is', () => {
			// A long November the fan has scrolled into: the window grew to 36
			// dates before the jump.
			const groups = months(['2026-11', 30], ['2026-12', 31], ['2027-01', 31])
			const { top } = openAt(sut, groups, '2026-11-01')
			for (let i = 0; i < 2; i++) {
				// @ts-expect-error -- the edge observer's callback
				sut.onEdgesSeen([{ isIntersecting: true, target: sut.bottomEdge }])
			}
			sut.bottomEdge = {} as HTMLElement
			// @ts-expect-error -- the edge observer's callback
			sut.onEdgesSeen([{ isIntersecting: true, target: sut.bottomEdge }])
			expect(built(sut).length).toBeGreaterThan(24)
			top.key = '2026-11-02'

			sut.jumpToMonth(1)

			expect(built(sut).length).toBeLessThanOrEqual(24)
			expect(built(sut)).toContain('2026-12-01')
			// The November dates scrolled past are not built until the fan
			// scrolls up to them.
			expect(built(sut)).not.toContain('2026-11-02')
		})

		it('adds no dates while the jump scrolls, and resumes when it ends', () => {
			vi.useFakeTimers()
			try {
				sut.topEdge = {} as HTMLElement
				const { top } = openAt(
					sut,
					months(['2026-11', 30], ['2026-12', 31]),
					'2026-11-14',
				)
				sut.jumpToMonth(1)
				top.key = '2026-12-01'
				const after = built(sut)

				// The top edge is within reach right after the jump.
				// @ts-expect-error -- the edge observer's callback
				sut.onEdgesSeen([{ isIntersecting: true, target: sut.topEdge }])
				expect(built(sut)).toEqual(after)

				// A browser that fires no `scrollend` is released by the timeout.
				vi.advanceTimersByTime(JUMP_SETTLE_MS)
				// @ts-expect-error -- the edge observer's callback
				sut.onEdgesSeen([{ isIntersecting: true, target: sut.topEdge }])
				expect(built(sut).length).toBeGreaterThan(after.length)
				expect(built(sut)[0] < after[0]).toBe(true)
			} finally {
				vi.useRealTimers()
			}
		})

		it('resumes growth on the scroll end of the jump, not of its placement', () => {
			vi.useFakeTimers()
			try {
				sut.topEdge = {} as HTMLElement
				const { top } = openAt(
					sut,
					months(['2026-11', 30], ['2026-12', 31]),
					'2026-11-14',
				)
				sut.jumpToMonth(1)
				top.key = '2026-12-01'
				const after = built(sut)

				// A `scrollend` in the same frame belongs to the instant placement.
				sut.onScrollEnd()
				// @ts-expect-error -- the edge observer's callback
				sut.onEdgesSeen([{ isIntersecting: true, target: sut.topEdge }])
				expect(built(sut)).toEqual(after)

				// One from a later frame ends the jump's smooth scroll.
				vi.advanceTimersByTime(20)
				sut.onScrollEnd()
				// @ts-expect-error -- the edge observer's callback
				sut.onEdgesSeen([{ isIntersecting: true, target: sut.topEdge }])
				expect(built(sut).length).toBeGreaterThan(after.length)
			} finally {
				vi.useRealTimers()
			}
		})

		// @spec components/infrastructure/fan/web/route/dashboard "No month in that direction"
		it('offers no next month from the last month with loaded dates', () => {
			const { top } = openAt(
				sut,
				months(['2026-11', 30], ['2026-12', 31]),
				'2026-11-28',
			)
			expect(sut.nextMonth).toEqual(new Date(2026, 11))

			// The fan scrolls into December; the buttons follow when it ends.
			top.key = '2026-12-02'
			sut.onScrollEnd()

			expect(sut.nextMonth).toBeNull()
			expect(sut.prevMonth).toEqual(new Date(2026, 10))
		})

		// @spec components/infrastructure/fan/web/route/dashboard "First display in a browser that cannot tell whether a list has been scrolled"
		it('offers the next month and no previous one on first display', () => {
			sut.dateGroups = months(['2026-11', 30], ['2026-12', 31])
			sut.binding()

			// Set before the view is attached, from the date the window opens at;
			// the stylesheet shows each button whose month exists.
			expect(sut.prevMonth).toBeNull()
			expect(sut.nextMonth).toEqual(new Date(2026, 11))
		})

		it(`follows a replaced list (${DASHBOARD})`, () => {
			const { top } = openAt(
				sut,
				months(['2026-11', 30], ['2026-12', 31]),
				'2026-11-14',
			)
			top.key = '2026-11-14'
			sut.dateGroups = months(['2026-11', 30])
			sut.dateGroupsChanged()

			expect(sut.nextMonth).toBeNull()
		})
	})

	describe('beam timelines', () => {
		function matchedGroups(count: number): DateGroup[] {
			return [
				{
					label: '2026-04-01',
					dateKey: '2026-04-01',
					isFirstOfMonth: false,
					monthSeparatorLabel: '',
					home: Array.from({ length: count }, (_, i) =>
						makeConcert({ id: `e${i}`, matched: true }),
					),
					nearby: [],
					away: [],
				},
			]
		}

		it('assigns one beam per matched concert, named after the concert', () => {
			sut.dateGroups = matchedGroups(3)
			sut.binding()
			sut.attached()

			// Named by concert, not by a running index, so the name a card carries
			// from the moment it is built never has to change.
			expect(sut.laserBeams.map((b) => b.timeline)).toEqual([
				'--beam-e0',
				'--beam-e1',
				'--beam-e2',
			])
		})

		it('puts every beam timeline in scope on the host', () => {
			sut.dateGroups = matchedGroups(2)
			sut.binding()
			sut.attached()

			// The beams sit in a viewport-fixed overlay and are NOT descendants of
			// the cards that drive them, so a named timeline only resolves if a
			// common ancestor scopes it. Written once per beam-set change — the
			// component no longer touches the DOM per frame at all.
			expect(fakeElement.style.setProperty).toHaveBeenCalledWith(
				'timeline-scope',
				'--beam-e0, --beam-e1',
			)
		})

		it('clears the timeline scope when nothing is matched', () => {
			sut.dateGroups = [
				{
					label: '2026-04-01',
					dateKey: '2026-04-01',
					isFirstOfMonth: false,
					monthSeparatorLabel: '',
					home: [makeConcert({ id: 'e0', matched: false })],
					nearby: [],
					away: [],
				},
			]
			sut.binding()
			sut.attached()

			expect(sut.laserBeams).toHaveLength(0)
			expect(fakeElement.style.setProperty).toHaveBeenCalledWith(
				'timeline-scope',
				'none',
			)
		})

		it('reads no card geometry and schedules no frames', () => {
			const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')

			sut.dateGroups = matchedGroups(4)
			sut.binding()
			sut.attached()

			// The whole point of driving beams from CSS: measuring cards forced
			// layout of content the browser would otherwise skip, so the component
			// must not query or measure the timetable at all. Nor schedule a frame —
			// a view timeline registers on its own once the browser has laid the
			// group out; a component-side nudge was tried and measured to change
			// nothing (18 of 40 live either way).
			expect(fakeElement.querySelectorAll).not.toHaveBeenCalled()
			expect(fakeElement.querySelector).not.toHaveBeenCalled()
			expect(rafSpy).not.toHaveBeenCalled()
		})
	})
})
