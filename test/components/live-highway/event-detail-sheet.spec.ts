import { IRouter } from '@aurelia/router'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import type { JourneyStatus } from '../../../src/entities/concert'
import {
	Events,
	IAnalyticsService,
} from '../../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../../src/services/auth-service'
import { IPushOfferService } from '../../../src/services/push-offer-service'
import { ITicketJourneyStore } from '../../../src/services/ticket-journey-store'
import { IUserStore } from '../../../src/services/user-store'
import { createTestContainer } from '../../helpers/create-container'
import { createMockHistory } from '../../helpers/mock-history'

const { EventDetailSheet } = await import(
	'../../../src/components/live-highway/event-detail-sheet'
)

function makeEvent(overrides: Partial<LiveEvent> = {}): LiveEvent {
	return {
		id: 'c1',
		artistName: 'Test Artist',
		artistId: 'a1',
		venueName: 'Test Venue',
		locationLabel: 'Tokyo',
		date: new Date(2026, 2, 15), // March 15, 2026
		startTime: '19:00',
		title: 'Test Concert',
		sourceUrl: 'https://example.com',
		hypeLevel: 'watch',
		...overrides,
	}
}

function createMockAuthService(isAuthenticated = true) {
	return { isAuthenticated }
}

describe('EventDetailSheet', () => {
	let sut: InstanceType<typeof EventDetailSheet>
	let mockHistory: ReturnType<typeof createMockHistory>
	let mockAnalytics: {
		capture: ReturnType<typeof vi.fn>
		identify: ReturnType<typeof vi.fn>
		reset: ReturnType<typeof vi.fn>
		getFeatureFlag: ReturnType<typeof vi.fn>
	}
	// Journey status now lives in the store (single source of truth). Back the mock
	// with a real map so `statusFor` reflects write-through writes.
	let journeyState: Map<string, JourneyStatus>
	let mockJourneyStore: {
		statusFor: ReturnType<typeof vi.fn>
		setStatus: ReturnType<typeof vi.fn>
		delete: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		// Opened from the dashboard; closing returns to the address it opened on.
		window.history.replaceState(null, '', '/dashboard')
		mockHistory = createMockHistory()
		mockAnalytics = {
			capture: vi.fn(),
			identify: vi.fn(),
			reset: vi.fn(),
			getFeatureFlag: vi.fn((_key: string, fallback: unknown) => fallback),
		}
		journeyState = new Map<string, JourneyStatus>()
		mockJourneyStore = {
			statusFor: vi.fn((id?: string) =>
				id ? journeyState.get(id) : undefined,
			),
			setStatus: vi.fn(async (id: string, status: JourneyStatus) => {
				journeyState.set(id, status)
			}),
			delete: vi.fn(async (id: string) => {
				journeyState.delete(id)
			}),
		}

		const container = createTestContainer(
			Registration.instance(IAuthService, createMockAuthService()),
			Registration.instance(IHistory, mockHistory),
			Registration.instance(IAnalyticsService, mockAnalytics),
			Registration.instance(ITicketJourneyStore, mockJourneyStore),
			Registration.instance(IPushOfferService, {
				pushState: vi.fn(async () => 'on'),
			}),
			Registration.instance(IUserStore, { currentHome: 'JP-13' }),
			Registration.instance(IRouter, { load: vi.fn() }),
		)
		container.register(EventDetailSheet)
		sut = container.get(EventDetailSheet)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('googleMapsUrl', () => {
		it('should construct URL with venue and localized area label', () => {
			sut.event = makeEvent({ venueName: 'Budokan', locationLabel: 'Tokyo' })

			expect(sut.googleMapsUrl).toBe(
				'https://www.google.com/maps/search/?api=1&query=Budokan%20Tokyo',
			)
		})

		it('should use only venue name when no area label', () => {
			sut.event = makeEvent({ venueName: 'Budokan', locationLabel: '' })

			expect(sut.googleMapsUrl).toBe(
				'https://www.google.com/maps/search/?api=1&query=Budokan',
			)
		})

		it('should return "#" when no event', () => {
			sut.event = null
			expect(sut.googleMapsUrl).toBe('#')
		})
	})

	describe('calendarUrl', () => {
		it('should construct Google Calendar URL', () => {
			sut.event = makeEvent({
				title: 'Rock Show',
				date: new Date(2026, 2, 15), // March 15
				startTime: '19:00',
				venueName: 'Budokan',
			})

			const url = sut.calendarUrl

			expect(url).toContain('calendar.google.com/calendar/render')
			expect(url).toContain('text=Rock%20Show')
			expect(url).toContain('dates=20260315T190000/')
			expect(url).toContain('location=Budokan')
		})

		it('should return "#" when no event', () => {
			sut.event = null
			expect(sut.calendarUrl).toBe('#')
		})
	})

	describe('source and calendar links', () => {
		it('reports the source link with the event and the artist', () => {
			// @spec components/infrastructure/fan/web/global/event-detail-sheet "Source link"
			sut.event = makeEvent()

			sut.onSourceOpened()

			expect(mockAnalytics.capture.mock.calls).toEqual([
				[Events.ConcertSourceClicked, { event_id: 'c1', artist_id: 'a1' }],
			])
		})

		it('reports the calendar link with the event and the artist', () => {
			sut.event = makeEvent()

			sut.onCalendarOpened()

			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				Events.ConcertCalendarAdded,
				{ event_id: 'c1', artist_id: 'a1', surface: 'detail_sheet' },
			)
		})
	})

	describe('open / close', () => {
		it('should open with event and call history.pushState with concerts/:id', () => {
			const event = makeEvent()

			sut.open(event)

			expect(sut.isOpen).toBe(true)
			expect(sut.event).toBe(event)
			expect(mockHistory.pushState).toHaveBeenCalledWith(
				{ concertId: 'c1' },
				'',
				'/concerts/c1',
			)
		})

		it('should close and call history.replaceState with dashboard', () => {
			sut.open(makeEvent())

			sut.close()

			expect(sut.isOpen).toBe(false)
			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard',
			)
		})

		it('should register popstate listener on open', () => {
			const addSpy = vi.spyOn(window, 'addEventListener')
			sut.open(makeEvent())

			expect(addSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
		})

		it('should remove popstate listener on close', () => {
			const removeSpy = vi.spyOn(window, 'removeEventListener')
			sut.open(makeEvent())

			sut.close()

			expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
		})

		it('fires concert.detail.viewed on open with the supplied source', () => {
			const event = makeEvent()

			sut.open(event, 'dashboard')

			expect(mockAnalytics.capture).toHaveBeenCalledTimes(1)
			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				'concert.detail.viewed',
				{
					event_id: 'c1',
					artist_id: 'a1',
					source: 'dashboard',
				},
			)
		})

		it("defaults source to 'page' when omitted", () => {
			const event = makeEvent()

			sut.open(event)

			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				'concert.detail.viewed',
				expect.objectContaining({ source: 'page' }),
			)
		})
	})

	describe('onSheetClosed', () => {
		it('should close and call replaceState when bottom-sheet fires sheet-closed', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Dismiss sheet by tapping outside it or pressing Escape"
			// @spec components/infrastructure/fan/web/route/dashboard "Dismiss sheet via swipe down"
			sut.open(makeEvent())

			sut.onSheetClosed()

			expect(sut.isOpen).toBe(false)
			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard',
			)
		})

		it('should do nothing when already closed', () => {
			sut.onSheetClosed()

			expect(mockHistory.replaceState).not.toHaveBeenCalled()
		})
	})

	describe('popstate handling', () => {
		it('should close sheet when popstate fires', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Dismiss sheet via browser back button"
			sut.open(makeEvent())

			window.dispatchEvent(new PopStateEvent('popstate'))

			expect(sut.isOpen).toBe(false)
			// The browser already navigated back; rewriting the URL would clobber it.
			expect(mockHistory.replaceState).not.toHaveBeenCalled()
		})

		it('should not close when popstate fires and sheet is not open', () => {
			sut.open(makeEvent())
			sut.close()

			const closeSpy = vi.spyOn(sut, 'close')
			window.dispatchEvent(new PopStateEvent('popstate'))

			expect(closeSpy).not.toHaveBeenCalled()
		})
	})

	describe('detaching', () => {
		it('should remove popstate listener on detach', () => {
			sut.open(makeEvent())
			const removeSpy = vi.spyOn(window, 'removeEventListener')

			sut.detaching()

			expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
		})

		it('should not throw when detaching without having opened', () => {
			expect(() => sut.detaching()).not.toThrow()
		})
	})
})
