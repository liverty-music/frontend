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
	let mockSheet: HTMLElement
	let mockScrollWrapper: HTMLElement
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

		// Mock sheet element for Popover API
		mockSheet = document.createElement('div')
		;(mockSheet as any).showPopover = vi.fn()
		;(mockSheet as any).hidePopover = vi.fn()
		;(mockSheet as any).focus = vi.fn()
		;(sut as any).sheetElement = mockSheet

		// Mock scroll wrapper for scroll snap dismiss
		mockScrollWrapper = document.createElement('div')
		Object.defineProperty(mockScrollWrapper, 'scrollTop', {
			value: 0,
			writable: true,
		})
		Object.defineProperty(mockScrollWrapper, 'clientHeight', {
			value: 400,
			writable: true,
		})
		;(sut as any).scrollWrapper = mockScrollWrapper
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

		it('should reset scroll position on open', () => {
			;(mockScrollWrapper as any).scrollTop = 100
			sut.open(makeEvent())

			expect(mockScrollWrapper.scrollTop).toBe(0)
		})

		it('should close and replace history state', () => {
			const replaceSpy = vi.spyOn(history, 'replaceState')
			sut.isOpen = true

			sut.close()

			expect(sut.isOpen).toBe(false)
			expect(replaceSpy).toHaveBeenCalledWith(null, '', '/dashboard')
		})
	})

	describe('scroll snap dismiss', () => {
		it('should close when scrolled past half of container height', () => {
			sut.open(makeEvent())

			// Simulate scrollend with scrollTop > clientHeight * 0.5
			const mockTarget = { scrollTop: 250, clientHeight: 400 }
			sut.onScrollEnd({ target: mockTarget } as any)

			expect(sut.isOpen).toBe(false)
		})

		it('should not close when scrolled less than half', () => {
			sut.open(makeEvent())

			const mockTarget = { scrollTop: 150, clientHeight: 400 }
			sut.onScrollEnd({ target: mockTarget } as any)

			expect(sut.isOpen).toBe(true)
		})
	})

	describe('dynamic popover mode', () => {
		it('should set popover="auto" when not in onboarding Step 4', () => {
			mockOnboarding.currentStep = OnboardingStep.COMPLETED
			sut.open(makeEvent())

			expect(mockSheet.popover).toBe('auto')
		})

		it('should set popover="manual" when in onboarding Step 4', () => {
			mockOnboarding.currentStep = OnboardingStep.DETAIL
			sut.open(makeEvent())

			expect(mockSheet.popover).toBe('manual')
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
			const replaceSpy = vi.spyOn(history, 'replaceState')

			window.dispatchEvent(new PopStateEvent('popstate'))

			expect(sut.isOpen).toBe(false)
			// Should skip history.replaceState when closed by popstate
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

	describe('toggle event (light dismiss)', () => {
		it('should clean up state when popover auto-dismisses', () => {
			sut.open(makeEvent())
			const replaceSpy = vi.spyOn(history, 'replaceState')

			// Simulate the browser firing toggle event on light dismiss
			const toggleEvent = new Event('toggle') as any
			toggleEvent.newState = 'closed'
			mockSheet.dispatchEvent(toggleEvent)

			expect(sut.isOpen).toBe(false)
			expect(replaceSpy).toHaveBeenCalledWith(null, '', '/dashboard')
		})

		it('should not clean up when toggle fires with newState="open"', () => {
			sut.open(makeEvent())

			const toggleEvent = new Event('toggle') as any
			toggleEvent.newState = 'open'
			mockSheet.dispatchEvent(toggleEvent)

			expect(sut.isOpen).toBe(true)
		})
	})

	describe('detaching', () => {
		it('should remove popstate and toggle listeners', () => {
			const removeWindowSpy = vi.spyOn(window, 'removeEventListener')
			const removeSheetSpy = vi.spyOn(mockSheet, 'removeEventListener')

			sut.detaching()

			expect(removeWindowSpy).toHaveBeenCalledWith(
				'popstate',
				expect.any(Function),
			)
			expect(removeSheetSpy).toHaveBeenCalledWith(
				'toggle',
				expect.any(Function),
			)
		})
	})
})
