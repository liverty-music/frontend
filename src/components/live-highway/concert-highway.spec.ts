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
	describe('scrollOffset', () => {
		function withScroller(
			el: {
				scrollTop: number
				scrollHeight: number
				clientHeight: number
			} | null,
		) {
			fakeElement.querySelector.mockImplementation(((sel: string) =>
				sel === '.concert-scroll' ? el : null) as never)
		}

		it('reads and writes the timetable scroll position', () => {
			const scroller = { scrollTop: 120, scrollHeight: 2000, clientHeight: 500 }
			withScroller(scroller)

			expect(sut.scrollOffset).toBe(120)

			sut.scrollOffset = 400
			expect(scroller.scrollTop).toBe(400)
		})

		it('clamps a restored offset to the content that is actually there', () => {
			// Off-screen groups are sized from an intrinsic estimate until they
			// render, and a refresh can return a shorter list, so a saved offset can
			// exceed the current extent. Landing past the end must clamp.
			const scroller = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 }
			withScroller(scroller)

			sut.scrollOffset = 5000

			expect(scroller.scrollTop).toBe(1500)
		})

		it('is inert before the view is in the DOM', () => {
			withScroller(null)

			expect(sut.scrollOffset).toBe(0)
			expect(() => {
				sut.scrollOffset = 400
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
