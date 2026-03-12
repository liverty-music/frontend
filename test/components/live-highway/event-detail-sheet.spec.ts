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
	let mockOnboarding: ReturnType<typeof createMockOnboarding>

	beforeEach(() => {
		mockOnboarding = createMockOnboarding()

		mockElement = document.createElement('div')
		const scrollable = document.createElement('div')
		scrollable.classList.add('overflow-y-auto')
		Object.defineProperty(scrollable, 'scrollTop', { value: 0, writable: true })
		mockElement.appendChild(scrollable)

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
		const sheetScrollable = document.createElement('div')
		sheetScrollable.classList.add('overflow-y-auto')
		Object.defineProperty(sheetScrollable, 'scrollTop', {
			value: 0,
			writable: true,
		})
		mockSheet.appendChild(sheetScrollable)
		;(sut as any).sheetElement = mockSheet
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
			sut.isOpen = true

			sut.close()

			expect(sut.isOpen).toBe(false)
			expect(sut.dragOffset).toBe(0)
			expect(replaceSpy).toHaveBeenCalledWith(null, '', '/dashboard')
		})
	})

	describe('touch drag dismiss', () => {
		it('should close when drag exceeds 100px threshold', () => {
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 250 }] } as any) // delta = 150
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(false)
		})

		it('should snap back when drag is below threshold', () => {
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 150 }] } as any) // delta = 50
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(true)
			expect(sut.dragOffset).toBe(0)
		})

		it('should not start drag when not open', () => {
			sut.isOpen = false

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 300 }] } as any)
			sut.onTouchEnd()

			expect(sut.dragOffset).toBe(0)
		})

		it('should not allow negative drag offset', () => {
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 200 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 100 }] } as any) // delta = -100

			expect(sut.dragOffset).toBe(0)
		})

		it('should block swipe when isDismissable is false (Step 4)', () => {
			mockOnboarding.currentStep = OnboardingStep.DETAIL
			sut.open(makeEvent())

			sut.onTouchStart({ touches: [{ clientY: 100 }] } as any)
			sut.onTouchMove({ touches: [{ clientY: 300 }] } as any)
			sut.onTouchEnd()

			expect(sut.isOpen).toBe(true)
			expect(sut.dragOffset).toBe(0)
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
			expect(sut.dragOffset).toBe(0)
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
