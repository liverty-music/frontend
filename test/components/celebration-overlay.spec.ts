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
	let onDismissed: ReturnType<typeof vi.fn>
	let onOpen: ReturnType<typeof vi.fn>

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

		onDismissed = vi.fn()
		onOpen = vi.fn()
		sut.onDismissed = onDismissed
		sut.onOpen = onOpen
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

		it('should call onOpen callback when shown', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			expect(onOpen).toHaveBeenCalledOnce()
		})
	})

	describe('onTap()', () => {
		it('should start fade-out on tap', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			sut.onTap()

			expect(sut.fadingOut).toBe(true)
		})

		it('should be a no-op when not visible', () => {
			sut.attached()

			sut.onTap()

			expect(sut.fadingOut).toBe(false)
		})

		it('should be a no-op when already fading out', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()
			sut.onTap()

			// Second tap during fade should be ignored
			sut.onTap()

			// Still fading, not hidden
			expect(sut.fadingOut).toBe(true)
			expect(sut.visible).toBe(true)
		})
	})

	describe('transitionend cleanup', () => {
		it('should clean up after opacity transitionend when fading out', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			sut.onTap()
			expect(sut.fadingOut).toBe(true)

			// Simulate CSS transition completing
			hostElement.dispatchEvent(createTransitionEvent('opacity'))

			expect(sut.visible).toBe(false)
			expect(sut.fadingOut).toBe(false)
			expect(onDismissed).toHaveBeenCalledOnce()
		})

		it('should ignore transitionend for non-opacity properties', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			sut.onTap()
			expect(sut.fadingOut).toBe(true)

			hostElement.dispatchEvent(createTransitionEvent('transform'))

			// Should still be fading out — not cleaned up
			expect(sut.fadingOut).toBe(true)
			expect(sut.visible).toBe(true)
			expect(onDismissed).not.toHaveBeenCalled()
		})

		it('should ignore transitionend when not fading out', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			// Fire transitionend during display phase (not fading yet)
			hostElement.dispatchEvent(createTransitionEvent('opacity'))

			expect(sut.visible).toBe(true)
			expect(onDismissed).not.toHaveBeenCalled()
		})
	})

	describe('prefers-reduced-motion', () => {
		it('should skip CSS transition and immediately dismiss on tap', () => {
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: true,
			} as MediaQueryList)

			sut.attached()
			sut.active = true
			sut.activeChanged()

			sut.onTap()

			// Should immediately clean up without waiting for transitionend
			expect(sut.visible).toBe(false)
			expect(sut.fadingOut).toBe(false)
			expect(onDismissed).toHaveBeenCalledOnce()
		})
	})

	describe('detaching() cleanup', () => {
		it('should call onDismissed when detaching during fade-out', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()
			sut.onTap()

			sut.detaching()

			expect(onDismissed).toHaveBeenCalledOnce()
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
