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

	describe('badges', () => {
		const base = {
			artistName: 'Artist',
			id: 'event-1',
			artistId: 'artist-1',
			venueName: 'Venue',
			locationLabel: 'Tokyo',
			date: new Date(2026, 2, 15),
			startTime: '19:00',
			title: 'Concert',
			sourceUrl: '',
			hypeLevel: 'home' as const,
			matched: true,
			artistHue: 0,
		}

		it('shows the journey badge on a discovered concert', () => {
			component.event = { ...base, isFirstParty: false, journeyStatus: 'paid' }
			expect(component.journeyConfig).toBeDefined()
			expect(component.isPurchased).toBe(false)
		})

		it('shows the purchased badge and no journey badge on a purchased first-party concert', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Purchased first-party concert"
			component.event = {
				...base,
				isFirstParty: true,
				purchasedTicketCount: 2,
				journeyStatus: 'applied',
			}
			expect(component.isPurchased).toBe(true)
			expect(component.journeyConfig).toBeUndefined()
		})

		it('shows no badge on a first-party concert without tickets', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "First-party concert not purchased"
			component.event = {
				...base,
				isFirstParty: true,
				purchasedTicketCount: 0,
				journeyStatus: 'applied',
			}
			expect(component.isPurchased).toBe(false)
			expect(component.journeyConfig).toBeUndefined()
		})
	})

	describe('onClick', () => {
		const liveEvent: LiveEvent = {
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

		it('should dispatch event-selected custom event with bubbling', () => {
			component.event = liveEvent

			const eventSpy = vi.fn()
			mockElement.addEventListener('event-selected', eventSpy)

			component.onClick()

			expect(eventSpy).toHaveBeenCalled()
			const customEvent = eventSpy.mock.calls[0][0] as CustomEvent
			expect(customEvent.detail.event).toBe(liveEvent)
			expect(customEvent.bubbles).toBe(true)
		})

		it('does NOT dispatch event-selected when readonly is true', () => {
			component.event = liveEvent
			component.readonly = true

			const eventSpy = vi.fn()
			mockElement.addEventListener('event-selected', eventSpy)

			component.onClick()

			expect(eventSpy).not.toHaveBeenCalled()
		})
	})
})
