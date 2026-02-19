import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
	DateGroup,
	LiveEvent,
} from '../../../src/components/live-highway/live-event'
import { LiveHighway } from '../../../src/components/live-highway/live-highway'
import { createTestContainer } from '../../helpers/create-container'

describe('LiveHighway', () => {
	let component: LiveHighway

	beforeEach(() => {
		const container = createTestContainer()
		container.register(LiveHighway)
		component = container.get(LiveHighway)
	})

	describe('isEmpty', () => {
		it('should return true when dateGroups is empty', () => {
			// Arrange
			component.dateGroups = []

			// Assert
			expect(component.isEmpty).toBe(true)
		})

		it('should return false when dateGroups has items', () => {
			// Arrange
			const mockGroup: DateGroup = {
				dateKey: '2026-03-15',
				label: 'March 15',
				main: [],
				region: [],
				other: [],
			}
			component.dateGroups = [mockGroup]

			// Assert
			expect(component.isEmpty).toBe(false)
		})
	})

	describe('onEventSelected', () => {
		it('should call detailSheet.open with the event from custom event', () => {
			// Arrange
			const mockEvent: LiveEvent = {
				id: 'event-1',
				artistName: 'Artist',
				artistId: 'artist-1',
				venueName: 'Venue',
				locationLabel: 'Tokyo',
				date: new Date(2026, 2, 15),
				startTime: '19:00',
				title: 'Concert',
				sourceUrl: 'https://example.com',
			}

			component.detailSheet = {
				open: vi.fn(),
			} as Partial<EventDetailSheet> as EventDetailSheet

			const customEvent = new CustomEvent('event-selected', {
				detail: { event: mockEvent },
			})

			// Act
			component.onEventSelected(customEvent)

			// Assert
			expect(component.detailSheet.open).toHaveBeenCalledWith(mockEvent)
		})
	})
})
