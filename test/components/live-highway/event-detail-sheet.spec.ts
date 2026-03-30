import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IHistory } from '../../../src/adapter/browser/history'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
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
	let mockHistory: ReturnType<typeof createMockHistory>

	beforeEach(() => {
		mockHistory = createMockHistory()

		const container = createTestContainer(
			Registration.instance(IAuthService, createMockAuthService()),
			Registration.instance(IHistory, mockHistory),
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
