import { INode, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventCard } from '../../../src/components/live-highway/event-card'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import { createTestContainer } from '../../helpers/create-container'

describe('EventCard', () => {
	let component: EventCard
	let mockElement: HTMLElement
	let mockAnalytics: {
		capture: ReturnType<typeof vi.fn>
		identify: ReturnType<typeof vi.fn>
		reset: ReturnType<typeof vi.fn>
		getFeatureFlag: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		mockElement = document.createElement('div')
		mockAnalytics = {
			capture: vi.fn(),
			identify: vi.fn(),
			reset: vi.fn(),
			getFeatureFlag: vi.fn((_key: string, fallback: unknown) => fallback),
		}
		const container = createTestContainer(
			Registration.instance(INode, mockElement),
			// Stub IAnalyticsService so the onClick analytics emission
			// can be asserted without spinning up the real PostHog
			// adapter (which would also pull in IConsentService et al.).
			Registration.instance(IAnalyticsService, mockAnalytics),
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

		it('fires concert.recommendation.clicked when position is bound', () => {
			component.event = liveEvent
			component.position = 2

			component.onClick()

			expect(mockAnalytics.capture).toHaveBeenCalledTimes(1)
			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				'concert.recommendation.clicked',
				{
					concert_id: 'event-1',
					artist_id: 'artist-1',
					position: 2,
				},
			)
		})

		it('does NOT fire concert.recommendation.clicked when position is null', () => {
			component.event = liveEvent
			component.position = null

			component.onClick()

			expect(mockAnalytics.capture).not.toHaveBeenCalled()
		})

		it('does NOT fire concert.recommendation.clicked when readonly is true', () => {
			component.event = liveEvent
			component.position = 3
			component.readonly = true

			component.onClick()

			expect(mockAnalytics.capture).not.toHaveBeenCalled()
		})
	})
})
