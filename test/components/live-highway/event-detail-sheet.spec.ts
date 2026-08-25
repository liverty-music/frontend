import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import type { JourneyStatus } from '../../../src/entities/concert'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../../src/services/auth-service'
import { ITicketJourneyStore } from '../../../src/services/ticket-journey-store'
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

	/** Seed the store status for the fixed event id used by makeEvent ('c1'). */
	function setStoreStatus(status: JourneyStatus | undefined): void {
		journeyState.clear()
		if (status) journeyState.set('c1', status)
	}

	beforeEach(() => {
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
			sut.open(makeEvent())

			window.dispatchEvent(new PopStateEvent('popstate'))

			expect(sut.isOpen).toBe(false)
		})

		it('should not close when popstate fires and sheet is not open', () => {
			sut.open(makeEvent())
			sut.close()

			const closeSpy = vi.spyOn(sut, 'close')
			window.dispatchEvent(new PopStateEvent('popstate'))

			expect(closeSpy).not.toHaveBeenCalled()
		})
	})

	describe('journey view-model', () => {
		it('marks passed states completed, current solid, future outlined (paid)', () => {
			setStoreStatus('paid')
			sut.event = makeEvent()

			expect(sut.nodeStates).toEqual({
				tracking: 'completed',
				applied: 'completed',
				unpaid: 'completed',
				paid: 'current',
				lost: 'future',
			})
		})

		it('treats outcome as future while applied (result pending)', () => {
			setStoreStatus('applied')
			sut.event = makeEvent()

			expect(sut.nodeStates).toEqual({
				tracking: 'completed',
				applied: 'current',
				lost: 'future',
				unpaid: 'future',
				paid: 'future',
			})
			expect(sut.outcomePending).toBe(true)
		})

		it('keeps outcome pending for tracking and undefined', () => {
			setStoreStatus('tracking')
			sut.event = makeEvent()
			expect(sut.outcomePending).toBe(true)

			setStoreStatus(undefined)
			sut.event = makeEvent()
			expect(sut.outcomePending).toBe(true)
		})

		it('clears outcome pending once a result is recorded', () => {
			for (const status of ['lost', 'unpaid', 'paid'] as const) {
				setStoreStatus(status)
				sut.event = makeEvent()
				expect(sut.outcomePending).toBe(false)
			}
		})

		it('dims the win route when a loss is recorded', () => {
			setStoreStatus('lost')
			sut.event = makeEvent()

			expect(sut.successDimmed).toBe(true)
			expect(sut.failureDimmed).toBe(false)
			expect(sut.nodeStates.lost).toBe('current')
		})

		it('dims the loss route when a win is recorded', () => {
			for (const status of ['unpaid', 'paid'] as const) {
				setStoreStatus(status)
				sut.event = makeEvent()
				expect(sut.failureDimmed).toBe(true)
				expect(sut.successDimmed).toBe(false)
			}
		})

		it('exposes exactly one current node per status', () => {
			for (const status of [
				'tracking',
				'applied',
				'lost',
				'unpaid',
				'paid',
			] as const) {
				setStoreStatus(status)
				sut.event = makeEvent()
				const current = Object.values(sut.nodeStates).filter(
					(s) => s === 'current',
				)
				expect(current).toHaveLength(1)
			}
		})
	})

	describe('journey radiogroup keyboard navigation', () => {
		// Build a KeyboardEvent stub whose currentTarget mimics the radiogroup
		// element: querySelector returns a focusable node we can assert on.
		function makeKeydown(key: string) {
			const focused = { focus: vi.fn() }
			const group = { querySelector: vi.fn(() => focused) }
			const event = {
				key,
				preventDefault: vi.fn(),
				currentTarget: group,
			} as unknown as KeyboardEvent
			return { event, group, focused }
		}

		it('gives the selected status the only tab stop (roving tabindex)', () => {
			setStoreStatus('paid')
			sut.event = makeEvent()
			expect(sut.journeyTabindex('paid')).toBe(0)
			expect(sut.journeyTabindex('tracking')).toBe(-1)
			expect(sut.journeyTabindex('lost')).toBe(-1)
		})

		it('makes the first node the tab stop when nothing is selected', () => {
			setStoreStatus(undefined)
			sut.event = makeEvent()
			expect(sut.journeyTabindex('tracking')).toBe(0)
			expect(sut.journeyTabindex('applied')).toBe(-1)
		})

		it('ArrowRight selects the next node and moves focus to it', async () => {
			setStoreStatus('tracking')
			sut.event = makeEvent()
			const { event, group, focused } = makeKeydown('ArrowRight')

			await sut.onJourneyKeydown(event)

			expect(event.preventDefault).toHaveBeenCalled()
			expect(mockJourneyStore.setStatus).toHaveBeenCalledWith('c1', 'applied')
			expect(group.querySelector).toHaveBeenCalledWith(
				'[data-journey-status="applied"]',
			)
			expect(focused.focus).toHaveBeenCalled()
		})

		it('ArrowLeft from the first node is a no-op (clamped, not wrapped)', async () => {
			setStoreStatus('tracking')
			sut.event = makeEvent()

			await sut.onJourneyKeydown(makeKeydown('ArrowLeft').event)

			expect(mockJourneyStore.setStatus).not.toHaveBeenCalled()
		})

		it('ArrowRight from paid does not cross to lost (mutually exclusive outcomes)', async () => {
			setStoreStatus('paid')
			sut.event = makeEvent()

			await sut.onJourneyKeydown(makeKeydown('ArrowRight').event)

			expect(mockJourneyStore.setStatus).not.toHaveBeenCalled()
		})

		it('ArrowLeft from lost does not cross to paid (mutually exclusive outcomes)', async () => {
			setStoreStatus('lost')
			sut.event = makeEvent()

			await sut.onJourneyKeydown(makeKeydown('ArrowLeft').event)

			expect(mockJourneyStore.setStatus).not.toHaveBeenCalled()
		})

		it('Home and End jump to the first and last nodes', async () => {
			setStoreStatus('unpaid')
			sut.event = makeEvent()

			await sut.onJourneyKeydown(makeKeydown('Home').event)
			expect(mockJourneyStore.setStatus).toHaveBeenLastCalledWith(
				'c1',
				'tracking',
			)

			await sut.onJourneyKeydown(makeKeydown('End').event)
			expect(mockJourneyStore.setStatus).toHaveBeenLastCalledWith('c1', 'lost')
		})

		it('ignores non-navigation keys', async () => {
			setStoreStatus('tracking')
			sut.event = makeEvent()
			const { event } = makeKeydown('a')

			await sut.onJourneyKeydown(event)

			expect(event.preventDefault).not.toHaveBeenCalled()
			expect(mockJourneyStore.setStatus).not.toHaveBeenCalled()
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
