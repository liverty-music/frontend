import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CelebrationOverlay } from '../../src/components/celebration-overlay/celebration-overlay'

function createTransitionEvent(propertyName: string): Event {
	const event = new Event('transitionend', { bubbles: true })
	Object.defineProperty(event, 'propertyName', { value: propertyName })
	return event
}

describe('CelebrationOverlay', () => {
	let sut: CelebrationOverlay
	let hostElement: HTMLElement
	let onComplete: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		// jsdom does not provide matchMedia — stub it to return no-preference by default
		window.matchMedia = vi
			.fn()
			.mockReturnValue({ matches: false } as MediaQueryList)
		hostElement = document.createElement('div')

		const container = DI.createContainer()
		container.register(Registration.instance(INode, hostElement))
		sut = container.get(CelebrationOverlay)

		onComplete = vi.fn()
		sut.onComplete = onComplete
	})

	afterEach(() => {
		sut.detaching()
		vi.restoreAllMocks()
	})

	describe('attached() with active already true', () => {
		it('should call show() when active was set before attached()', () => {
			sut.active = true
			sut.attached()

			expect(sut.visible).toBe(true)
			expect(sut.fadingOut).toBe(false)
		})

		it('should not call show() when active is false', () => {
			sut.active = false
			sut.attached()

			expect(sut.visible).toBe(false)
		})
	})

	describe('activeChanged()', () => {
		it('should show overlay when active becomes true', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			expect(sut.visible).toBe(true)
		})

		it('should not show overlay twice', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()
			sut.activeChanged()

			// shown flag prevents double-show
			expect(sut.visible).toBe(true)
		})
	})

	describe('transitionend cleanup', () => {
		it('should clean up after opacity transitionend when fading out', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			// Advance past display duration (2500ms default)
			vi.advanceTimersByTime(2500)
			expect(sut.fadingOut).toBe(true)

			// Simulate CSS transition completing
			hostElement.dispatchEvent(createTransitionEvent('opacity'))

			expect(sut.visible).toBe(false)
			expect(sut.fadingOut).toBe(false)
			expect(onComplete).toHaveBeenCalledOnce()
		})

		it('should ignore transitionend for non-opacity properties', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			vi.advanceTimersByTime(2500)
			expect(sut.fadingOut).toBe(true)

			hostElement.dispatchEvent(createTransitionEvent('transform'))

			// Should still be fading out — not cleaned up
			expect(sut.fadingOut).toBe(true)
			expect(sut.visible).toBe(true)
			expect(onComplete).not.toHaveBeenCalled()
		})

		it('should ignore transitionend when not fading out', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			// Fire transitionend during display phase (not fading yet)
			hostElement.dispatchEvent(createTransitionEvent('opacity'))

			expect(sut.visible).toBe(true)
			expect(onComplete).not.toHaveBeenCalled()
		})
	})

	describe('prefers-reduced-motion', () => {
		it('should use shorter display duration and skip transition', () => {
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: true,
			} as MediaQueryList)

			sut.attached()
			sut.active = true
			sut.activeChanged()

			// Reduced motion display duration is 1500ms
			vi.advanceTimersByTime(1500)

			// Should immediately clean up without waiting for transitionend
			expect(sut.visible).toBe(false)
			expect(sut.fadingOut).toBe(false)
			expect(onComplete).toHaveBeenCalledOnce()
		})
	})

	describe('detaching() cleanup', () => {
		it('should clear timer on detach', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			// Timer is running for display duration
			sut.detaching()

			// Advancing time should not trigger fade-out
			vi.advanceTimersByTime(5000)
			expect(sut.fadingOut).toBe(false)
		})

		it('should remove transitionend listener on detach', () => {
			const removeSpy = vi.spyOn(hostElement, 'removeEventListener')
			sut.attached()
			sut.detaching()

			expect(removeSpy).toHaveBeenCalledWith(
				'transitionend',
				expect.any(Function),
			)
		})
	})
})
