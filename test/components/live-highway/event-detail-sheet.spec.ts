import { INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '../../../src/components/live-highway/live-event'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../../src/services/onboarding-service'
import { createTestContainer } from '../../helpers/create-container'

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

function createMockOnboarding(step = OnboardingStep.COMPLETED) {
	return {
		currentStep: step,
		spotlightTarget: '',
		spotlightMessage: '',
		spotlightRadius: '12px',
		spotlightActive: false,
		onSpotlightTap: undefined,
		onBringToFront: undefined,
		isOnboarding: false,
		isCompleted: true,
		activateSpotlight: vi.fn(),
		deactivateSpotlight: vi.fn(),
		bringSpotlightToFront: vi.fn(),
		setStep: vi.fn(),
		complete: vi.fn(),
		reset: vi.fn(),
		getRouteForCurrentStep: vi.fn(() => ''),
	}
}

describe('EventDetailSheet', () => {
	let sut: InstanceType<typeof EventDetailSheet>
	let mockElement: HTMLElement
	let mockOnboarding: ReturnType<typeof createMockOnboarding>

	beforeEach(() => {
		mockOnboarding = createMockOnboarding()

		mockElement = document.createElement('div')

		const container = createTestContainer(
			Registration.instance(INode, mockElement),
			Registration.instance(IOnboardingService, mockOnboarding),
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
		it('should open with event and push history state', () => {
			const pushSpy = vi.spyOn(history, 'pushState')
			const event = makeEvent()

			sut.open(event)

			expect(sut.isOpen).toBe(true)
			expect(sut.event).toBe(event)
			expect(pushSpy).toHaveBeenCalledWith(
				{ concertId: 'c1' },
				'',
				'/concerts/c1',
			)
		})

		it('should close and replace history state', () => {
			const replaceSpy = vi.spyOn(history, 'replaceState')
			sut.open(makeEvent())

			sut.close()

			expect(sut.isOpen).toBe(false)
			expect(replaceSpy).toHaveBeenCalledWith(null, '', '/dashboard')
		})
	})

	describe('onSheetClosed', () => {
		it('should close and replace history when bottom-sheet fires sheet-closed', () => {
			const replaceSpy = vi.spyOn(history, 'replaceState')
			sut.open(makeEvent())

			sut.onSheetClosed()

			expect(sut.isOpen).toBe(false)
			expect(replaceSpy).toHaveBeenCalledWith(null, '', '/dashboard')
		})
	})

	describe('isDismissable', () => {
		it('should return true when not in Step 4', () => {
			mockOnboarding.currentStep = OnboardingStep.DASHBOARD
			expect(sut.isDismissable).toBe(true)
		})

		it('should return false when in Step 4 (DETAIL)', () => {
			mockOnboarding.currentStep = OnboardingStep.DETAIL
			expect(sut.isDismissable).toBe(false)
		})
	})

	describe('popstate handling', () => {
		it('should close sheet when popstate fires', () => {
			sut.open(makeEvent())

			window.dispatchEvent(new PopStateEvent('popstate'))

			expect(sut.isOpen).toBe(false)
		})

		it('should skip replaceState in onSheetClosed after popstate', () => {
			const replaceSpy = vi.spyOn(history, 'replaceState')
			sut.open(makeEvent())

			// Simulate popstate firing before toggle (browser back)
			window.dispatchEvent(new PopStateEvent('popstate'))
			replaceSpy.mockClear()

			// Then bottom-sheet fires sheet-closed
			sut.onSheetClosed()

			// Should not call replaceState since popstate already handled navigation
			expect(replaceSpy).not.toHaveBeenCalled()
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
		it('should remove popstate listener', () => {
			const removeWindowSpy = vi.spyOn(window, 'removeEventListener')

			sut.detaching()

			expect(removeWindowSpy).toHaveBeenCalledWith(
				'popstate',
				expect.any(Function),
			)
		})
	})
})
