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

			expect(sut.beamIndexMap.e1).toBe(0)
			expect(sut.beamIndexMap.e2).toBe(1)
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

			expect(Object.keys(sut.beamIndexMap).length).toBe(0)
			expect(sut.laserBeams.length).toBe(0)
		})
	})

	describe('beamIndexMap lookup', () => {
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

			expect(sut.beamIndexMap.e1).toBe(0)
		})

		it('returns undefined for unknown event', () => {
			sut.attached()

			expect(sut.beamIndexMap.unknown).toBeUndefined()
		})
	})

	describe('detaching', () => {
		it('releases the one frame and the one listener it takes', () => {
			const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
			const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')

			sut.attached()
			sut.detaching()

			// The component used to own a scroll listener and a rAF loop that
			// measured every matched card each frame. That is gone — the beams
			// follow their concert through a view timeline now. What remains is a
			// SINGLE frame: a view timeline only registers while its date group is
			// being rendered, and before the first layout every group is skipped, so
			// the names have to be declared again once. Exactly one, and released.
			expect(rafSpy).toHaveBeenCalledTimes(1)
			expect(cancelSpy).toHaveBeenCalledTimes(1)
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

			expect(sut.beamIndexMap.x).toBe(0)
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

			expect(Object.keys(sut.beamIndexMap).length).toBe(0)
		})
	})
})
