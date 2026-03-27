import { INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertHighway } from '../../src/components/live-highway/concert-highway'
import type { DateGroup } from '../../src/entities/concert'
import { createTestContainer } from '../helpers/create-container'

describe('ConcertHighway', () => {
	let sut: ConcertHighway
	let mockElement: HTMLElement

	beforeEach(() => {
		mockElement = document.createElement('div')
		const scrollChild = document.createElement('div')
		scrollChild.classList.add('concert-scroll')
		mockElement.appendChild(scrollChild)

		const container = createTestContainer(
			Registration.instance(INode, mockElement),
		)
		container.register(ConcertHighway)
		sut = container.get(ConcertHighway)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('buildBeamIndexMap', () => {
		it('assigns sequential indices to matched events', () => {
			const groups: DateGroup[] = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					home: [
						{
							id: 'e1',
							matched: true,
							artistName: 'Artist A',
						} as DateGroup['home'][0],
					],
					nearby: [],
					away: [
						{
							id: 'e2',
							matched: true,
							artistName: 'Artist B',
						} as DateGroup['away'][0],
					],
				},
			]

			sut.dateGroups = groups
			sut.attached()

			expect(sut.beamIndexMap.get('e1')).toBe(0)
			expect(sut.beamIndexMap.get('e2')).toBe(1)
			expect(sut.laserBeams.length).toBe(2)
		})

		it('does not assign indices to non-matched events', () => {
			const groups: DateGroup[] = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					home: [
						{
							id: 'e1',
							matched: false,
							artistName: 'A',
						} as DateGroup['home'][0],
					],
					nearby: [],
					away: [],
				},
			]

			sut.dateGroups = groups
			sut.attached()

			expect(sut.beamIndexMap.size).toBe(0)
			expect(sut.laserBeams.length).toBe(0)
		})
	})

	describe('getBeamIndex', () => {
		it('returns index for matched event', () => {
			sut.dateGroups = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					home: [
						{
							id: 'e1',
							matched: true,
							artistName: 'A',
						} as DateGroup['home'][0],
					],
					nearby: [],
					away: [],
				},
			]
			sut.attached()

			expect(sut.getBeamIndex('e1')).toBe(0)
		})

		it('returns null for unknown event', () => {
			sut.attached()

			expect(sut.getBeamIndex('unknown')).toBeNull()
		})
	})

	describe('detaching', () => {
		it('removes scroll listener', () => {
			sut.attached()
			const scrollEl = mockElement.querySelector('.concert-scroll')!
			const removeSpy = vi.spyOn(scrollEl, 'removeEventListener')

			sut.detaching()

			expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
		})

		it('cancels pending rAF', () => {
			const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')
			vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(42)

			sut.attached()
			sut.detaching()

			expect(cancelSpy).toHaveBeenCalledWith(42)
		})
	})

	describe('dateGroupsChanged', () => {
		it('rebuilds beam map when attached and groups change', () => {
			sut.attached()

			sut.dateGroups = [
				{
					label: 'Feb 1',
					dateKey: '2026-02-01',
					home: [
						{ id: 'x', matched: true, artistName: 'X' } as DateGroup['home'][0],
					],
					nearby: [],
					away: [],
				},
			]
			sut.dateGroupsChanged()

			expect(sut.beamIndexMap.get('x')).toBe(0)
		})

		it('does not rebuild beam map before attached', () => {
			sut.dateGroups = [
				{
					label: 'Feb 1',
					dateKey: '2026-02-01',
					home: [
						{ id: 'x', matched: true, artistName: 'X' } as DateGroup['home'][0],
					],
					nearby: [],
					away: [],
				},
			]
			sut.dateGroupsChanged()

			expect(sut.beamIndexMap.size).toBe(0)
		})
	})
})
