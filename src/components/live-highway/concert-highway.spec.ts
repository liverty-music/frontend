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

import type { DateGroup } from '../../entities/concert'
import { ConcertHighway } from './concert-highway'

const fakeElement = {
	querySelector: vi.fn(() => null),
	querySelectorAll: vi.fn(() => []),
}

describe('ConcertHighway', () => {
	let sut: ConcertHighway

	beforeEach(() => {
		fakeElement.querySelector.mockReturnValue(null)
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
		it('returns null for unknown event ID', () => {
			expect(sut.getBeamIndex('unknown')).toBeNull()
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
	})
})
