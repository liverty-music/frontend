import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { createMockLogger } from '../helpers/mock-logger'

const { CoachMark } = await import('../../src/components/coach-mark/coach-mark')

function createMockOnboarding() {
	return {
		currentStep: 7,
		spotlightTarget: '',
		spotlightMessage: '',
		spotlightRadius: '12px',
		spotlightActive: false,
		onSpotlightTap: undefined as (() => void) | undefined,
		onBringToFront: undefined as (() => void) | undefined,
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

function createMockElement(
	opts: { top?: number; height?: number } = {},
): HTMLElement {
	const el = document.createElement('div')
	el.getBoundingClientRect = () =>
		({
			top: opts.top ?? 100,
			bottom: (opts.top ?? 100) + (opts.height ?? 50),
			left: 50,
			right: 200,
			width: 150,
			height: opts.height ?? 50,
			x: 50,
			y: opts.top ?? 100,
			toJSON: () => ({}),
		}) as DOMRect
	// Stub scrollIntoView since jsdom doesn't implement it
	el.scrollIntoView = vi.fn()
	return el
}

describe('CoachMark', () => {
	let sut: InstanceType<typeof CoachMark>
	let overlayEl: HTMLElement
	let targetEl: HTMLElement
	let mockOnboarding: ReturnType<typeof createMockOnboarding>

	beforeEach(() => {
		vi.useFakeTimers()
		mockOnboarding = createMockOnboarding()

		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(
			Registration.instance(IOnboardingService, mockOnboarding),
		)

		sut = container.invoke(CoachMark)

		// Stub the overlayEl ref with mock popover methods
		overlayEl = document.createElement('div')
		overlayEl.showPopover = vi.fn()
		overlayEl.hidePopover = vi.fn()
		;(sut as unknown as { overlayEl: HTMLElement }).overlayEl = overlayEl

		// Create a target element in the document
		targetEl = createMockElement()
		targetEl.setAttribute('data-test-target', '')
		document.body.appendChild(targetEl)

		// Mock document.querySelector to find the target
		sut.targetSelector = '[data-test-target]'
	})

	afterEach(() => {
		vi.useRealTimers()
		document.body.removeChild(targetEl)
		vi.restoreAllMocks()
	})

	describe('highlight and popover', () => {
		it('should set anchor-name on target when highlighted', async () => {
			sut.active = true
			sut.activeChanged()

			// Advance past scrollend failsafe
			await vi.advanceTimersByTimeAsync(900)

			expect(targetEl.style.getPropertyValue('anchor-name')).toBe(
				'--coach-target',
			)
		})

		it('should open popover only once (continuous spotlight persistence)', async () => {
			sut.active = true
			sut.activeChanged()

			// Advance past scrollend failsafe
			await vi.advanceTimersByTimeAsync(900)

			expect(overlayEl.showPopover).toHaveBeenCalledTimes(1)

			// Create a second target
			const target2 = createMockElement()
			target2.setAttribute('data-test-target-2', '')
			document.body.appendChild(target2)

			sut.targetSelector = '[data-test-target-2]'
			sut.targetSelectorChanged()

			await vi.advanceTimersByTimeAsync(900)

			// showPopover should still only have been called once
			expect(overlayEl.showPopover).toHaveBeenCalledTimes(1)

			document.body.removeChild(target2)
		})

		it('should not call hidePopover when changing target', async () => {
			sut.active = true
			sut.activeChanged()

			await vi.advanceTimersByTimeAsync(900)

			// Change target
			const target2 = createMockElement()
			target2.setAttribute('data-test-target-2', '')
			document.body.appendChild(target2)

			sut.targetSelector = '[data-test-target-2]'
			sut.targetSelectorChanged()

			expect(overlayEl.hidePopover).not.toHaveBeenCalled()

			document.body.removeChild(target2)
		})
	})

	describe('deactivate', () => {
		it('should call hidePopover and clean up anchor-name and scroll lock', async () => {
			// Set up au-viewport for scroll lock test
			const viewport = document.createElement('au-viewport')
			document.body.appendChild(viewport)

			sut.active = true
			sut.activeChanged()

			// Advance past scrollend failsafe so popover opens
			await vi.advanceTimersByTimeAsync(900)

			// Verify scroll lock is active
			expect(viewport.style.getPropertyValue('overflow')).toBe('hidden')

			// Deactivate
			sut.deactivate()

			expect(overlayEl.hidePopover).toHaveBeenCalledTimes(1)
			expect(targetEl.style.getPropertyValue('anchor-name')).toBe('')
			expect(viewport.style.getPropertyValue('overflow')).toBe('')
			expect(sut.visible).toBe(false)

			document.body.removeChild(viewport)
		})
	})

	describe('scroll into view', () => {
		it('should always call scrollIntoView to let the browser decide', async () => {
			sut.active = true
			sut.activeChanged()

			// Advance past scrollend failsafe
			await vi.advanceTimersByTimeAsync(900)

			expect(targetEl.scrollIntoView).toHaveBeenCalledWith({
				behavior: 'smooth',
				block: 'center',
				inline: 'center',
			})
		})

		it('should resolve via scrollend event when fired before failsafe', async () => {
			sut.active = true
			sut.activeChanged()

			// Simulate scrollend firing immediately
			window.dispatchEvent(new Event('scrollend'))
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.visible).toBe(true)
			expect(overlayEl.showPopover).toHaveBeenCalledTimes(1)
		})
	})

	describe('click interaction', () => {
		it('should not call onTap when blocker is clicked (blocks interaction)', () => {
			const onTap = vi.fn()
			sut.onTap = onTap

			sut.onBlockerClick()

			expect(onTap).not.toHaveBeenCalled()
		})

		it('should call onTap only when target interceptor is clicked', () => {
			const onTap = vi.fn()
			sut.onTap = onTap

			const event = new Event('click', { bubbles: true })
			vi.spyOn(event, 'preventDefault')
			vi.spyOn(event, 'stopPropagation')

			sut.onTargetClick(event)

			expect(onTap).toHaveBeenCalledTimes(1)
			expect(event.preventDefault).toHaveBeenCalled()
			expect(event.stopPropagation).toHaveBeenCalled()
		})

		it('should not throw when onTap is undefined and target is clicked', () => {
			sut.onTap = undefined
			const event = new Event('click')
			expect(() => sut.onTargetClick(event)).not.toThrow()
		})
	})

	describe('spotlightRadius', () => {
		it('should default to 12px', () => {
			expect(sut.spotlightRadius).toBe('12px')
		})
	})

	describe('retry behavior', () => {
		it('should set visible to false when target is not found after retries', async () => {
			sut.targetSelector = '[data-nonexistent]'
			sut.active = true
			sut.activeChanged()

			// Advance past MAX_RETRY_MS (5000ms)
			await vi.advanceTimersByTimeAsync(6000)

			expect(sut.visible).toBe(false)
		})
	})

	describe('bringToFront', () => {
		it('should call hidePopover then showPopover when popover is open', async () => {
			// Open the popover first
			sut.active = true
			sut.activeChanged()
			await vi.advanceTimersByTimeAsync(900)

			expect(overlayEl.showPopover).toHaveBeenCalledTimes(1)

			// Reset call counts
			;(overlayEl.hidePopover as ReturnType<typeof vi.fn>).mockClear()
			;(overlayEl.showPopover as ReturnType<typeof vi.fn>).mockClear()

			sut.bringToFront()
			await vi.advanceTimersByTimeAsync(16) // requestAnimationFrame

			expect(overlayEl.hidePopover).toHaveBeenCalledTimes(1)
			expect(overlayEl.showPopover).toHaveBeenCalledTimes(1)
		})

		it('should be no-op when popover is not open', async () => {
			sut.bringToFront()
			await vi.advanceTimersByTimeAsync(16)

			expect(overlayEl.hidePopover).not.toHaveBeenCalled()
			expect(overlayEl.showPopover).not.toHaveBeenCalled()
		})
	})

	describe('onboarding service integration', () => {
		it('should register onBringToFront callback on bound()', () => {
			sut.bound()
			expect(mockOnboarding.onBringToFront).toBeTypeOf('function')
		})

		it('should clear onBringToFront callback on detaching()', () => {
			sut.bound()
			expect(mockOnboarding.onBringToFront).toBeDefined()

			sut.detaching()
			expect(mockOnboarding.onBringToFront).toBeUndefined()
		})

		it('should trigger bringToFront when onboarding service calls callback', async () => {
			sut.active = true
			sut.bound()
			await vi.advanceTimersByTimeAsync(900)

			;(overlayEl.hidePopover as ReturnType<typeof vi.fn>).mockClear()
			;(overlayEl.showPopover as ReturnType<typeof vi.fn>).mockClear()

			// Simulate onboarding service calling the callback
			mockOnboarding.onBringToFront?.()
			await vi.advanceTimersByTimeAsync(16)

			expect(overlayEl.hidePopover).toHaveBeenCalledTimes(1)
			expect(overlayEl.showPopover).toHaveBeenCalledTimes(1)
		})
	})
})
