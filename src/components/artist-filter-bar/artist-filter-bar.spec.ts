import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return { ...actual, bindable: actual.bindable }
})

import type { CountedArtist } from '../../entities/artist'
import { ArtistFilterBar } from './artist-filter-bar'

function makeCounted(id: string, name: string, count: number): CountedArtist {
	return { id, name, count }
}

describe('ArtistFilterBar', () => {
	let sut: ArtistFilterBar

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new ArtistFilterBar()
		sut.countedArtists = [
			makeCounted('a1', 'Artist One', 3),
			makeCounted('a2', 'Artist Two', 1),
		]
	})

	describe('openSheet', () => {
		it('copies both facet selections to pending and opens the sheet', () => {
			sut.selectedIds = ['a1']
			sut.selectedStatuses = ['applied']
			sut.openSheet()

			expect(sut.pendingIds).toEqual(['a1'])
			expect(sut.pendingStatuses).toEqual(['applied'])
			expect(sut.isSheetOpen).toBe(true)
		})

		it('resets pending selections to current on a second open', () => {
			sut.selectedIds = ['a1']
			sut.selectedStatuses = ['applied']
			sut.openSheet()
			sut.pendingIds = ['a1', 'a2']
			sut.pendingStatuses = ['applied', 'paid']

			sut.openSheet()

			expect(sut.pendingIds).toEqual(['a1'])
			expect(sut.pendingStatuses).toEqual(['applied'])
		})
	})

	describe('confirmSelection', () => {
		it('commits both pending facets and closes the sheet', () => {
			sut.openSheet()
			sut.pendingIds = ['a1', 'a2']
			sut.pendingStatuses = ['unpaid']
			sut.confirmSelection()

			expect(sut.selectedIds).toEqual(['a1', 'a2'])
			expect(sut.selectedStatuses).toEqual(['unpaid'])
			expect(sut.isSheetOpen).toBe(false)
		})

		it('clears both filters when all pending are deselected', () => {
			sut.selectedIds = ['a1']
			sut.selectedStatuses = ['applied']
			sut.openSheet()
			sut.pendingIds = []
			sut.pendingStatuses = []
			sut.confirmSelection()

			expect(sut.selectedIds).toEqual([])
			expect(sut.selectedStatuses).toEqual([])
		})
	})

	describe('clearAll', () => {
		it('clears pending selections across both facets', () => {
			sut.openSheet()
			sut.pendingIds = ['a1']
			sut.pendingStatuses = ['applied']

			sut.clearAll()

			expect(sut.pendingIds).toEqual([])
			expect(sut.pendingStatuses).toEqual([])
		})
	})

	describe('hasPendingSelection', () => {
		it('is true when only an artist is pending', () => {
			sut.pendingIds = ['a1']
			sut.pendingStatuses = []
			expect(sut.hasPendingSelection).toBe(true)
		})

		it('is true when only a journey status is pending', () => {
			sut.pendingIds = []
			sut.pendingStatuses = ['paid']
			expect(sut.hasPendingSelection).toBe(true)
		})

		it('is false when nothing is pending in either facet', () => {
			sut.pendingIds = []
			sut.pendingStatuses = []
			expect(sut.hasPendingSelection).toBe(false)
		})
	})

	describe('showJourneyFacet', () => {
		it('is hidden for guests and shown for authenticated users', () => {
			sut.isAuthenticated = false
			expect(sut.showJourneyFacet).toBe(false)

			sut.isAuthenticated = true
			expect(sut.showJourneyFacet).toBe(true)
		})
	})

	describe('journey phase ordering', () => {
		it('splits statuses into process then outcome with the flow order', () => {
			expect(sut.processStatuses.map((c) => c.status)).toEqual([
				'tracking',
				'applied',
			])
			expect(sut.outcomeStatuses.map((c) => c.status)).toEqual([
				'unpaid',
				'paid',
				'lost',
			])
		})
	})
})
