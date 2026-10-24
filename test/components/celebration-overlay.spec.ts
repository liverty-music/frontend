import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ILocalStorage } from '../../src/adapter/storage/local-storage'
import { CelebrationOverlay } from '../../src/components/celebration-overlay/celebration-overlay'
import { createMockLocalStorage } from '../helpers/mock-local-storage'

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

	describe('post-signup effects', () => {
		let oscillators: number
		let vibrate: ReturnType<typeof vi.fn>

		/** A Web Audio stand-in that counts the voices the engine starts. */
		class FakeAudioContext {
			public state = 'running'
			public currentTime = 0
			public destination = {}
			private param() {
				return {
					value: 0,
					setValueAtTime: vi.fn(),
					linearRampToValueAtTime: vi.fn(),
					exponentialRampToValueAtTime: vi.fn(),
				}
			}
			private node() {
				return { connect: vi.fn(), disconnect: vi.fn() }
			}
			public createGain() {
				return { ...this.node(), gain: this.param() }
			}
			public createBiquadFilter() {
				return {
					...this.node(),
					type: '',
					Q: this.param(),
					frequency: this.param(),
				}
			}
			public createOscillator() {
				oscillators += 1
				return {
					...this.node(),
					type: '',
					frequency: this.param(),
					start: vi.fn(),
					stop: vi.fn(),
					onended: null,
				}
			}
			public resume() {
				return Promise.resolve()
			}
		}

		function build(opts: { muted?: boolean; activated?: boolean } = {}) {
			const container = DI.createContainer()
			container.register(
				Registration.instance(INode, document.createElement('div')),
				Registration.instance(
					ILocalStorage,
					createMockLocalStorage(opts.muted ? { 'sound.muted': '1' } : {}),
				),
			)
			Object.defineProperty(navigator, 'userActivation', {
				configurable: true,
				value: { hasBeenActive: opts.activated ?? true, isActive: false },
			})
			const overlay = container.get(CelebrationOverlay)
			overlay.confetti = true
			overlay.active = true
			return overlay
		}

		beforeEach(() => {
			oscillators = 0
			vibrate = vi.fn()
			Object.defineProperty(navigator, 'vibrate', {
				configurable: true,
				value: vibrate,
			})
			;(window as unknown as { AudioContext: unknown }).AudioContext =
				FakeAudioContext
		})

		afterEach(() => {
			delete (navigator as unknown as Record<string, unknown>).userActivation
			delete (navigator as unknown as Record<string, unknown>).vibrate
		})

		it('bursts confetti, plays the celebration and vibrates once', () => {
			const overlay = build()

			overlay.attached()

			expect(overlay.pieces).toHaveLength(40)
			expect(oscillators).toBeGreaterThan(0)
			expect(vibrate).toHaveBeenCalledTimes(1)
			overlay.detaching()
		})

		it('varies the size, spin and speed of the pieces and starts them at the centre', () => {
			const overlay = build()
			overlay.attached()

			const values = (key: 'size' | 'spin' | 'duration' | 'dx') =>
				new Set(overlay.pieces.map((p) => p[key]))
			expect(values('size').size).toBeGreaterThan(1)
			expect(values('spin').size).toBeGreaterThan(1)
			expect(values('duration').size).toBeGreaterThan(1)
			// Each piece flies its own way from the centre.
			expect(values('dx').size).toBeGreaterThan(1)
			expect(new Set(overlay.pieces.map((p) => p.shape))).toEqual(
				new Set(['square', 'circle', 'strip']),
			)
			overlay.detaching()
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Muted sound"
		it('plays no sound when muted, while the confetti still bursts', () => {
			const overlay = build({ muted: true })

			overlay.attached()

			expect(oscillators).toBe(0)
			expect(overlay.pieces).toHaveLength(40)
			overlay.detaching()
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Reduced motion preference"
		it('shows no confetti and does not vibrate with reduced motion; the sound still plays', () => {
			window.matchMedia = vi
				.fn()
				.mockReturnValue({ matches: true } as MediaQueryList)
			const overlay = build()

			overlay.attached()

			expect(overlay.visible).toBe(true)
			expect(overlay.pieces).toHaveLength(0)
			expect(vibrate).not.toHaveBeenCalled()
			expect(oscillators).toBeGreaterThan(0)

			// Disappears without a transition.
			overlay.onTap()
			expect(overlay.visible).toBe(false)
			expect(onDismissed).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "No sound or vibration before the fan has touched the page"
		it('keeps the burst but no sound or vibration before the fan has touched the page', () => {
			const overlay = build({ activated: false })

			overlay.attached()

			expect(overlay.pieces).toHaveLength(40)
			expect(oscillators).toBe(0)
			expect(vibrate).not.toHaveBeenCalled()
			overlay.detaching()
		})

		it('runs no effect on the light tier', () => {
			const overlay = build()
			overlay.confetti = false

			overlay.attached()

			expect(overlay.pieces).toHaveLength(0)
			expect(oscillators).toBe(0)
			expect(vibrate).not.toHaveBeenCalled()
			overlay.detaching()
		})
	})

	describe('fade-out without a transitionend', () => {
		it('finishes the dismissal when the browser skips the transition', () => {
			sut.active = true
			sut.attached()
			sut.onTap()
			expect(sut.overlayState).toBe('exiting')

			vi.advanceTimersByTime(600)

			expect(sut.overlayState).toBe('hidden')
			expect(onDismissed).toHaveBeenCalledOnce()
		})

		it('dismisses once when the transitionend comes first', () => {
			sut.active = true
			sut.attached()
			sut.onTap()
			hostElement.dispatchEvent(createTransitionEvent('opacity'))

			vi.advanceTimersByTime(600)

			expect(onDismissed).toHaveBeenCalledOnce()
		})
	})
})
