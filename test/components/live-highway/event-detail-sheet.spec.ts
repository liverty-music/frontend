import { DI, type IDisposable, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import { IAuthService } from '../../../src/services/auth-service'
import { createTestContainer } from '../../helpers/create-container'
import { createMockRouter } from '../../helpers/mock-router'
import { createMockRouterEvents } from '../../helpers/mock-router-events'

const mockIRouter = DI.createInterface('IRouter')
const mockIRouterEvents = DI.createInterface('IRouterEvents')

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
	IRouterEvents: mockIRouterEvents,
}))

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
		adminArea: 'Tokyo',
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
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockRouterEvents: ReturnType<typeof createMockRouterEvents>

	beforeEach(() => {
		mockRouter = createMockRouter()
		mockRouterEvents = createMockRouterEvents()

		const container = createTestContainer(
			Registration.instance(IAuthService, createMockAuthService()),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIRouterEvents, mockRouterEvents),
		)
		container.register(EventDetailSheet)
		sut = container.get(EventDetailSheet)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('googleMapsUrl', () => {
		it('should construct URL with venue and admin area', () => {
			sut.event = makeEvent({ venueName: 'Budokan', adminArea: 'Tokyo' })

			expect(sut.googleMapsUrl).toBe(
				'https://www.google.com/maps/search/?api=1&query=Budokan%20Tokyo',
			)
		})

		it('should use only venue name when no admin area', () => {
			sut.event = makeEvent({ venueName: 'Budokan', adminArea: undefined })

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
		it('should open with event and call router.load with concerts/:id', () => {
			const event = makeEvent()

			sut.open(event)

			expect(sut.isOpen).toBe(true)
			expect(sut.event).toBe(event)
			expect(mockRouter.load).toHaveBeenCalledWith('concerts/c1', {
				historyStrategy: 'push',
			})
		})

		it('should subscribe to router navigation-end on open', () => {
			sut.open(makeEvent())

			expect(mockRouterEvents.subscribe).toHaveBeenCalledWith(
				'au:router:navigation-end',
				expect.any(Function),
			)
		})

		it('should close and navigate to dashboard via router.load', () => {
			sut.open(makeEvent())

			sut.close()

			expect(sut.isOpen).toBe(false)
			expect(mockRouter.load).toHaveBeenCalledWith('dashboard', {
				historyStrategy: 'replace',
			})
		})

		it('should dispose navSub on close', () => {
			sut.open(makeEvent())
			const sub = (mockRouterEvents.subscribe as ReturnType<typeof vi.fn>).mock
				.results[0]?.value as IDisposable
			expect(sub).toBeDefined()

			sut.close()

			expect(sub.dispose).toHaveBeenCalled()
		})
	})

	describe('onSheetClosed', () => {
		it('should close and navigate to dashboard when bottom-sheet fires sheet-closed', () => {
			sut.open(makeEvent())

			sut.onSheetClosed()

			expect(sut.isOpen).toBe(false)
			expect(mockRouter.load).toHaveBeenCalledWith('dashboard', {
				historyStrategy: 'replace',
			})
		})

		it('should do nothing when already closed', () => {
			sut.onSheetClosed()

			expect(mockRouter.load).not.toHaveBeenCalled()
		})
	})

	describe('router navigation-end handling', () => {
		it('should close sheet when router navigates away from concerts/', () => {
			sut.open(makeEvent())

			// Retrieve the navigation-end callback registered on open
			const cb = (mockRouterEvents.subscribe as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1] as (e: {
				finalInstructions: { toPath(): string }
			}) => void

			cb({ finalInstructions: { toPath: () => 'dashboard' } })

			expect(sut.isOpen).toBe(false)
		})

		it('should NOT close sheet when router navigates to concerts/', () => {
			sut.open(makeEvent())

			const cb = (mockRouterEvents.subscribe as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1] as (e: {
				finalInstructions: { toPath(): string }
			}) => void

			cb({ finalInstructions: { toPath: () => 'concerts/c1' } })

			expect(sut.isOpen).toBe(true)
		})

		it('should not react to navigation when sheet is already closed', () => {
			sut.open(makeEvent())
			sut.close()

			const cb = (mockRouterEvents.subscribe as ReturnType<typeof vi.fn>).mock
				.calls[0]?.[1] as (e: {
				finalInstructions: { toPath(): string }
			}) => void

			// Should not throw / change already-closed state
			cb({ finalInstructions: { toPath: () => 'dashboard' } })

			expect(sut.isOpen).toBe(false)
		})
	})

	describe('detaching', () => {
		it('should dispose navSub on detach', () => {
			sut.open(makeEvent())
			const sub = (mockRouterEvents.subscribe as ReturnType<typeof vi.fn>).mock
				.results[0]?.value as IDisposable

			sut.detaching()

			expect(sub.dispose).toHaveBeenCalled()
		})

		it('should not throw when detaching without having opened', () => {
			expect(() => sut.detaching()).not.toThrow()
		})
	})
})
