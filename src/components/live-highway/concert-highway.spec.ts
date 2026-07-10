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
		merchUrl: '',
		hypeLevel: 'home',
		matched: true,
		...overrides,
	}
}

describe('ConcertHighway', () => {
	let sut: ConcertHighway

	beforeEach(() => {
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

	describe('cached anchor-to-element resolution', () => {
		function primeFrame(): FrameRequestCallback[] {
			const frames: FrameRequestCallback[] = []
			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				frames.push(cb)
				return frames.length
			})
			return frames
		}

		it('builds the anchor→element map from data-beam-index on dateGroups change and resolves cards from it', () => {
			const frames = primeFrame()
			const card = {
				dataset: { beamIndex: '0' },
				getBoundingClientRect: () => ({ top: 10, bottom: 100 }),
			}
			const beam = {
				dataset: { beamAnchor: '0' },
				style: { setProperty: vi.fn() },
			}
			fakeElement.querySelectorAll.mockImplementation((selector: string) => {
				if (selector === '.laser-beam') return [beam]
				if (selector === '[data-beam-index]') return [card]
				return []
			})

			sut.dateGroups = [
				{
					label: '2026-04-01',
					dateKey: '2026-04-01',
					home: [makeConcert({ id: 'e1', matched: true })],
					nearby: [],
					away: [],
				},
			]
			sut.attached()

			// Run the frame scheduled by the beam-set rebuild.
			for (const cb of frames.splice(0)) cb(0)

			// The map was built once from a single [data-beam-index] query...
			expect(fakeElement.querySelectorAll).toHaveBeenCalledWith(
				'[data-beam-index]',
			)
			const cache = (sut as unknown as { beamElements: Map<number, unknown> })
				.beamElements
			expect(cache.get(0)).toBe(card)

			// ...and no per-frame per-beam element query was issued.
			expect(fakeElement.querySelector).not.toHaveBeenCalledWith(
				expect.stringContaining('data-beam-index'),
			)

			// Card geometry resolved via the cache drove the beam write.
			expect(beam.style.setProperty).toHaveBeenCalledWith('--beam-h', '100px')
			expect(beam.style.setProperty).toHaveBeenCalledWith(
				'--beam-top-pct',
				'10%',
			)
		})

		it('skips a beam whose anchor card is absent from the cache without error', () => {
			const frames = primeFrame()
			const beam = {
				dataset: { beamAnchor: '0' },
				style: { setProperty: vi.fn() },
			}
			fakeElement.querySelectorAll.mockImplementation((selector: string) => {
				if (selector === '.laser-beam') return [beam]
				// No matching [data-beam-index] card mounted yet.
				return []
			})

			sut.dateGroups = [
				{
					label: '2026-04-01',
					dateKey: '2026-04-01',
					home: [makeConcert({ id: 'e1', matched: true })],
					nearby: [],
					away: [],
				},
			]
			sut.attached()

			expect(() => {
				for (const cb of frames.splice(0)) cb(0)
			}).not.toThrow()
			expect(beam.style.setProperty).not.toHaveBeenCalled()
		})
	})

	describe('detaching lifecycle', () => {
		it('cancels animation frame and removes scroll listener', () => {
			const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')

			sut.attached()
			sut.detaching()

			// Should not throw even without active rAF
			expect(cancelSpy).toHaveBeenCalled()
		})

		it('clears the cached anchor→element map', () => {
			const card = {
				dataset: { beamIndex: '0' },
				getBoundingClientRect: () => ({ top: 10, bottom: 100 }),
			}
			const cache = (sut as unknown as { beamElements: Map<number, unknown> })
				.beamElements
			cache.set(0, card)

			sut.detaching()

			expect(cache.size).toBe(0)
		})
	})
})
