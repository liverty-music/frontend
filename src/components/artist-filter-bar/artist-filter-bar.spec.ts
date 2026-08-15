import { beforeEach, describe, expect, it, vi } from 'vitest'

// The component resolves its host element (INode) to dispatch the date-changed
// event. Provide a stub element that records dispatched events.
const dispatched: CustomEvent[] = []
const mockElement = {
	dispatchEvent: vi.fn((e: Event) => {
		dispatched.push(e as CustomEvent)
		return true
	}),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		bindable: actual.bindable,
		observable: actual.observable,
		resolve: vi.fn(() => mockElement),
	}
})

import type { CountedArtist } from '../../entities/artist'
import { formatDateInput, todayCalendarDate } from '../../lib/plain-date'
import { ArtistFilterBar } from './artist-filter-bar'

function makeCounted(id: string, name: string, count: number): CountedArtist {
	return { id, name, count }
}

describe('ArtistFilterBar', () => {
	let sut: ArtistFilterBar

	beforeEach(() => {
		vi.clearAllMocks()
		dispatched.length = 0
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

	describe('date facet', () => {
		const past = { year: 2020, month: 1, day: 1 }

		it('seeds the pending date from activeFrom and stays collapsed for the default', () => {
			sut.activeFrom = todayCalendarDate()
			sut.openSheet()

			expect(sut.pendingFrom).toBe(formatDateInput(todayCalendarDate()))
			expect(sut.isDateFacetExpanded).toBe(false)
		})

		it('auto-expands the facet when a non-default date is active', () => {
			sut.activeFrom = past
			sut.openSheet()

			expect(sut.pendingFrom).toBe('2020-01-01')
			expect(sut.isDateFacetExpanded).toBe(true)
		})

		it('dispatches date-changed with the parsed date on confirm when it changed', () => {
			sut.activeFrom = todayCalendarDate()
			sut.openSheet()
			sut.pendingFrom = '2020-01-01'
			sut.confirmSelection()

			expect(dispatched).toHaveLength(1)
			expect(dispatched[0].type).toBe('date-changed')
			expect(dispatched[0].detail).toEqual(past)
			expect(sut.isSheetOpen).toBe(false)
		})

		it('does not dispatch when the confirmed date matches the active from', () => {
			sut.activeFrom = past
			sut.openSheet()
			// pendingFrom seeded to 2020-01-01; confirm without changing it.
			sut.confirmSelection()

			expect(dispatched).toHaveLength(0)
		})

		it('falls back to today (clearing the window) on a malformed input', () => {
			sut.activeFrom = past
			sut.openSheet()
			sut.pendingFrom = 'garbage'
			sut.confirmSelection()

			expect(dispatched).toHaveLength(1)
			expect(dispatched[0].detail).toEqual(todayCalendarDate())
		})

		it('clearAll resets the pending date to today and collapses the facet', () => {
			sut.activeFrom = past
			sut.openSheet()
			sut.clearAll()

			expect(sut.pendingFrom).toBe(formatDateInput(todayCalendarDate()))
			expect(sut.isDateFacetExpanded).toBe(false)
		})

		it('hasPendingSelection is true when only a past date is pending', () => {
			sut.pendingIds = []
			sut.pendingStatuses = []
			sut.pendingFrom = '2020-01-01'
			expect(sut.hasPendingSelection).toBe(true)
		})

		it('isFilterActive reflects a non-default active from', () => {
			sut.selectedIds = []
			sut.selectedStatuses = []
			sut.activeFrom = todayCalendarDate()
			expect(sut.isFilterActive).toBe(false)

			sut.activeFrom = past
			expect(sut.isFilterActive).toBe(true)
		})
	})
})
