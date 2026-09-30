import { INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beamTimelineName } from '../../src/components/live-highway/beam-name'
import { ConcertHighway } from '../../src/components/live-highway/concert-highway'
import type { DateGroup } from '../../src/entities/concert'
import { createTestContainer } from '../helpers/create-container'
import { makeConcert } from '../helpers/mock-date-groups'

function group(
	dateKey: string,
	ids: { id: string; matched: boolean }[],
): DateGroup {
	return {
		label: dateKey,
		dateKey,
		isFirstOfMonth: false,
		monthSeparatorLabel: '',
		home: ids.map((c) => makeConcert(c)),
		nearby: [],
		away: [],
	}
}

describe('ConcertHighway beams', () => {
	let sut: ConcertHighway
	let mockElement: HTMLElement

	beforeEach(() => {
		mockElement = document.createElement('div')
		const container = createTestContainer(
			Registration.instance(INode, mockElement),
		)
		container.register(ConcertHighway)
		sut = container.get(ConcertHighway)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('builds one beam per matched concert only', () => {
		sut.dateGroups = [
			group('2026-01-01', [
				{ id: 'e1', matched: true },
				{ id: 'e2', matched: false },
			]),
			group('2026-01-02', [{ id: 'e3', matched: true }]),
		]
		sut.binding()
		sut.attached()

		expect(sut.laserBeams.map((b) => b.timeline)).toEqual([
			'--beam-e1',
			'--beam-e3',
		])
	})

	// @spec components/infrastructure/fan/web/global/live-highway "Disabled beams cost nothing"
	it('computes no beam set while the effect is off', () => {
		sut.showBeams = false
		sut.dateGroups = [group('2026-01-01', [{ id: 'e1', matched: true }])]
		sut.binding()
		sut.attached()

		expect(sut.laserBeams).toEqual([])
		expect(mockElement.style.getPropertyValue('timeline-scope')).toBe('none')
	})

	it('builds the beam set when the effect is turned on, and clears it when off', () => {
		sut.showBeams = false
		sut.dateGroups = [group('2026-01-01', [{ id: 'e1', matched: true }])]
		sut.binding()
		sut.attached()

		sut.showBeams = true
		sut.showBeamsChanged()
		expect(sut.laserBeams.map((b) => b.timeline)).toEqual(['--beam-e1'])
		expect(mockElement.style.getPropertyValue('timeline-scope')).toBe(
			'--beam-e1',
		)

		sut.showBeams = false
		sut.showBeamsChanged()
		expect(sut.laserBeams).toEqual([])
		expect(mockElement.style.getPropertyValue('timeline-scope')).toBe('none')
	})

	it('rebuilds the beam set when the groups change after attach, not before', () => {
		sut.dateGroups = [group('2026-02-01', [{ id: 'x', matched: true }])]
		sut.dateGroupsChanged()
		expect(sut.laserBeams).toEqual([])

		sut.binding()
		sut.attached()
		sut.dateGroups = [group('2026-02-02', [{ id: 'y', matched: true }])]
		sut.dateGroupsChanged()
		expect(sut.laserBeams.map((b) => b.timeline)).toEqual(['--beam-y'])
	})

	it('has nothing to tear down — the beams are driven by CSS', () => {
		const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')

		sut.binding()
		sut.attached()
		sut.detaching()

		expect(rafSpy).not.toHaveBeenCalled()
	})
})

describe('ConcertHighway loading placeholder', () => {
	it('drops the placeholder in the same step that builds the window', () => {
		const container = createTestContainer(
			Registration.instance(INode, document.createElement('div')),
		)
		container.register(ConcertHighway)
		const sut = container.get(ConcertHighway)
		sut.loading = true
		sut.binding()
		expect(sut.showSkeleton).toBe(true)

		// The data arrives: the groups that replace the placeholder are built in
		// this same call, so the placeholder must go in it too — never a frame
		// with both on screen.
		sut.attached()
		sut.dateGroups = [group('2026-01-01', [{ id: 'e1', matched: false }])]
		sut.dateGroupsChanged()
		expect(sut.visibleGroups).toHaveLength(1)
		expect(sut.showSkeleton).toBe(false)
	})

	it('shows no placeholder once loading ends, even with nothing to show', () => {
		const container = createTestContainer(
			Registration.instance(INode, document.createElement('div')),
		)
		container.register(ConcertHighway)
		const sut = container.get(ConcertHighway)
		sut.loading = true
		sut.binding()
		sut.loading = false
		sut.loadingChanged()
		expect(sut.showSkeleton).toBe(false)
	})
})

describe('beamTimelineName', () => {
	it('is a dashed ident derived from the concert id', () => {
		expect(beamTimelineName('0193a1b2-c3d4-7e5f')).toBe(
			'--beam-0193a1b2-c3d4-7e5f',
		)
	})

	it('replaces characters an identifier cannot hold', () => {
		expect(beamTimelineName('a.b/c d')).toBe('--beam-a_b_c_d')
	})
})
