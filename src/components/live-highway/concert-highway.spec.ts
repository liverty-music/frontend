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
import { ConcertHighway } from './concert-highway'

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
		hypeLevel: 'home',
		matched: true,
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

	describe('beam index map', () => {
		it('returns undefined for unknown event ID', () => {
			expect(sut.beamIndexMap.unknown).toBeUndefined()
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
			// Pixel arithmetic cannot land: off-screen groups are sized from an
			// intrinsic estimate, and correcting for it renders more groups, which
			// moves the estimate again. The browser has to resolve it.
			const target = group('2026-07-18', 4000, 4400)
			const scroller = withScroller({ scrollTop: 0 }, 100, [target])

			sut.scrollAnchor = { dateKey: '2026-07-18', offset: 60 }

			expect(target.scrollIntoView).toHaveBeenCalledWith({
				block: 'start',
				inline: 'nearest',
			})
			expect(scroller?.scrollTop).toBe(60)
		})

		it('stays put when the anchored date is no longer in the list', () => {
			// A background refresh can drop a date that has since passed. Guessing
			// at a replacement would land the fan somewhere they never were.
			const scroller = withScroller({ scrollTop: 250 }, 100, [
				group('2026-07-20', 40, 500),
			])

			sut.scrollAnchor = { dateKey: '2026-07-18', offset: 60 }

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

		it('assigns one beam per matched concert and names a timeline for each', () => {
			sut.dateGroups = matchedGroups(3)
			sut.attached()

			expect(sut.laserBeams).toHaveLength(3)
			expect(sut.laserBeams.map((b) => b.anchorIndex)).toEqual([0, 1, 2])
			expect(sut.beamIndexMap).toEqual({ e0: 0, e1: 1, e2: 2 })
		})

		it('puts every beam timeline in scope on the host', () => {
			sut.dateGroups = matchedGroups(2)
			sut.attached()

			// The beams sit in a viewport-fixed overlay and are NOT descendants of
			// the cards that drive them, so a named timeline only resolves if a
			// common ancestor scopes it. Written once per beam-set change — the
			// component no longer touches the DOM per frame at all.
			expect(fakeElement.style.setProperty).toHaveBeenCalledWith(
				'timeline-scope',
				'--beam-0, --beam-1',
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
			sut.attached()

			expect(sut.laserBeams).toHaveLength(0)
			expect(fakeElement.style.setProperty).toHaveBeenCalledWith(
				'timeline-scope',
				'none',
			)
		})

		it('reads no card geometry and schedules no frames', () => {
			sut.dateGroups = matchedGroups(4)
			sut.attached()

			// The whole point of driving beams from CSS: measuring cards forced
			// layout of content the browser would otherwise skip, so the component
			// must not query or measure the timetable at all.
			expect(fakeElement.querySelectorAll).not.toHaveBeenCalled()
			expect(fakeElement.querySelector).not.toHaveBeenCalled()
		})
	})
})
