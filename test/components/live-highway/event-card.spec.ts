import { INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventCard } from '../../../src/components/live-highway/event-card'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { createTestContainer } from '../../helpers/create-container'

describe('EventCard', () => {
	let component: EventCard
	let mockElement: HTMLElement

	beforeEach(() => {
		mockElement = document.createElement('div')
		const container = createTestContainer(
			Registration.instance(INode, mockElement),
		)
		container.register(EventCard)
		component = container.get(EventCard)
	})

	describe('backgroundColor', () => {
		it('should return HSL color based on artist name', () => {
			// Arrange
			component.event = {
				artistName: 'Radiohead',
				id: 'event-1',
				artistId: 'artist-1',
				venueName: 'Venue',
				locationLabel: 'Tokyo',
				date: new Date(2026, 2, 15),
				startTime: '19:00',
				title: 'Concert',
				sourceUrl: 'https://example.com',
			}

			// Act
			const color = component.backgroundColor

			// Assert
			expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
		})

		it('should return same color for same artist name', () => {
			// Arrange
			const event: LiveEvent = {
				artistName: 'Pink Floyd',
				id: 'event-1',
				artistId: 'artist-1',
				venueName: 'Venue',
				locationLabel: 'Tokyo',
				date: new Date(2026, 2, 15),
				startTime: '19:00',
				title: 'Concert',
				sourceUrl: 'https://example.com',
			}
			component.event = event

			// Act
			const color1 = component.backgroundColor
			const color2 = component.backgroundColor

			// Assert
			expect(color1).toBe(color2)
		})
	})

	describe('formattedDate', () => {
		it('should format date in Japanese locale', () => {
			// Arrange
			component.event = {
				artistName: 'Artist',
				id: 'event-1',
				artistId: 'artist-1',
				venueName: 'Venue',
				locationLabel: 'Tokyo',
				date: new Date(2026, 2, 15), // March 15, 2026
				startTime: '19:00',
				title: 'Concert',
				sourceUrl: 'https://example.com',
			}

			// Act
			const formatted = component.formattedDate

			// Assert - check format contains expected parts
			expect(formatted).toMatch(/3月/) // March in Japanese
			expect(formatted).toContain('15') // Day
		})
	})

	describe('onClick', () => {
		it('should dispatch event-selected custom event with bubbling', () => {
			// Arrange
			const event: LiveEvent = {
				artistName: 'Artist',
				id: 'event-1',
				artistId: 'artist-1',
				venueName: 'Venue',
				locationLabel: 'Tokyo',
				date: new Date(2026, 2, 15),
				startTime: '19:00',
				title: 'Concert',
				sourceUrl: 'https://example.com',
			}
			component.event = event

			const eventSpy = vi.fn()
			mockElement.addEventListener('event-selected', eventSpy)

			// Act
			component.onClick()

			// Assert
			expect(eventSpy).toHaveBeenCalled()
			const customEvent = eventSpy.mock.calls[0][0] as CustomEvent
			expect(customEvent.detail.event).toBe(event)
			expect(customEvent.bubbles).toBe(true)
		})
	})
})
