import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { IAnalyticsService } from '../../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../../src/services/auth-service'
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
		merchUrl: '',
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

	beforeEach(() => {
		mockHistory = createMockHistory()
		mockAnalytics = {
			capture: vi.fn(),
			identify: vi.fn(),
			reset: vi.fn(),
			getFeatureFlag: vi.fn((_key: string, fallback: unknown) => fallback),
		}

		const container = createTestContainer(
			Registration.instance(IAuthService, createMockAuthService()),
			Registration.instance(IHistory, mockHistory),
			Registration.instance(IAnalyticsService, mockAnalytics),
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

	describe('hasMerchUrl (merch link gating)', () => {
		it('is true when the event carries a merch URL', () => {
			sut.event = makeEvent({ merchUrl: 'https://artist.example.com/goods' })
			expect(sut.hasMerchUrl).toBe(true)
		})

		it('is false when the merch URL is empty', () => {
			sut.event = makeEvent({ merchUrl: '' })
			expect(sut.hasMerchUrl).toBe(false)
		})

		it('is false when there is no event', () => {
			sut.event = null
			expect(sut.hasMerchUrl).toBe(false)
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
			sut.event = makeEvent({ journeyStatus: 'paid' })

			expect(sut.nodeStates).toEqual({
				tracking: 'completed',
				applied: 'completed',
				unpaid: 'completed',
				paid: 'current',
				lost: 'future',
			})
		})

		it('treats outcome as future while applied (result pending)', () => {
			sut.event = makeEvent({ journeyStatus: 'applied' })

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
			sut.event = makeEvent({ journeyStatus: 'tracking' })
			expect(sut.outcomePending).toBe(true)

			sut.event = makeEvent({ journeyStatus: undefined })
			expect(sut.outcomePending).toBe(true)
		})

		it('clears outcome pending once a result is recorded', () => {
			for (const status of ['lost', 'unpaid', 'paid'] as const) {
				sut.event = makeEvent({ journeyStatus: status })
				expect(sut.outcomePending).toBe(false)
			}
		})

		it('dims the win route when a loss is recorded', () => {
			sut.event = makeEvent({ journeyStatus: 'lost' })

			expect(sut.successDimmed).toBe(true)
			expect(sut.failureDimmed).toBe(false)
			expect(sut.nodeStates.lost).toBe('current')
		})

		it('dims the loss route when a win is recorded', () => {
			for (const status of ['unpaid', 'paid'] as const) {
				sut.event = makeEvent({ journeyStatus: status })
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
				sut.event = makeEvent({ journeyStatus: status })
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
			sut.event = makeEvent({ journeyStatus: 'paid' })
			expect(sut.journeyTabindex('paid')).toBe(0)
			expect(sut.journeyTabindex('tracking')).toBe(-1)
			expect(sut.journeyTabindex('lost')).toBe(-1)
		})

		it('makes the first node the tab stop when nothing is selected', () => {
			sut.event = makeEvent({ journeyStatus: undefined })
			expect(sut.journeyTabindex('tracking')).toBe(0)
			expect(sut.journeyTabindex('applied')).toBe(-1)
		})

		it('ArrowRight selects the next node and moves focus to it', async () => {
			sut.event = makeEvent({ journeyStatus: 'tracking' })
			const setStatus = vi
				.spyOn(
					(
						sut as unknown as {
							journeyService: { setStatus: () => Promise<void> }
						}
					).journeyService,
					'setStatus',
				)
				.mockResolvedValue(undefined)
			const { event, group, focused } = makeKeydown('ArrowRight')

			await sut.onJourneyKeydown(event)

			expect(event.preventDefault).toHaveBeenCalled()
			expect(setStatus).toHaveBeenCalledWith('c1', 'applied')
			expect(group.querySelector).toHaveBeenCalledWith(
				'[data-journey-status="applied"]',
			)
			expect(focused.focus).toHaveBeenCalled()
		})

		it('ArrowLeft wraps from the first node to the last', async () => {
			sut.event = makeEvent({ journeyStatus: 'tracking' })
			const setStatus = vi
				.spyOn(
					(
						sut as unknown as {
							journeyService: { setStatus: () => Promise<void> }
						}
					).journeyService,
					'setStatus',
				)
				.mockResolvedValue(undefined)

			await sut.onJourneyKeydown(makeKeydown('ArrowLeft').event)

			expect(setStatus).toHaveBeenCalledWith('c1', 'lost')
		})

		it('Home and End jump to the first and last nodes', async () => {
			sut.event = makeEvent({ journeyStatus: 'unpaid' })
			const setStatus = vi
				.spyOn(
					(
						sut as unknown as {
							journeyService: { setStatus: () => Promise<void> }
						}
					).journeyService,
					'setStatus',
				)
				.mockResolvedValue(undefined)

			await sut.onJourneyKeydown(makeKeydown('Home').event)
			expect(setStatus).toHaveBeenLastCalledWith('c1', 'tracking')

			await sut.onJourneyKeydown(makeKeydown('End').event)
			expect(setStatus).toHaveBeenLastCalledWith('c1', 'lost')
		})

		it('ignores non-navigation keys', async () => {
			sut.event = makeEvent({ journeyStatus: 'tracking' })
			const setStatus = vi
				.spyOn(
					(
						sut as unknown as {
							journeyService: { setStatus: () => Promise<void> }
						}
					).journeyService,
					'setStatus',
				)
				.mockResolvedValue(undefined)
			const { event } = makeKeydown('a')

			await sut.onJourneyKeydown(event)

			expect(event.preventDefault).not.toHaveBeenCalled()
			expect(setStatus).not.toHaveBeenCalled()
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
