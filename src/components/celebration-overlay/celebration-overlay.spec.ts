import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			if (token === actual.ILogger) return fakeLogger
			if (token === actual.INode) return fakeHost
			return {}
		}),
		bindable: actual.bindable,
	}
})

import { CelebrationOverlay } from './celebration-overlay'

const fakeLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	scopeTo: vi.fn(() => fakeLogger),
}

let fakeHost: {
	addEventListener: ReturnType<typeof vi.fn>
	removeEventListener: ReturnType<typeof vi.fn>
}

describe('CelebrationOverlay', () => {
	let sut: CelebrationOverlay

	beforeEach(() => {
		fakeHost = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		}
		sut = new CelebrationOverlay()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('overlayState', () => {
		it('returns hidden when not visible', () => {
			expect(sut.overlayState).toBe('hidden')
		})

		it('returns active when visible and not fading', () => {
			sut.active = true
			sut.attached()

			expect(sut.overlayState).toBe('active')
		})
	})

	describe('active changed', () => {
		it('shows overlay when active becomes true', () => {
			sut.attached()
			sut.active = true
			sut.activeChanged()

			expect(sut.visible).toBe(true)
		})

		it('does not re-show if already shown', () => {
			const openSpy = vi.fn()
			sut.onOpen = openSpy
			sut.attached()
			sut.active = true
			sut.activeChanged()
			sut.activeChanged()

			expect(openSpy).toHaveBeenCalledOnce()
		})
	})

	describe('onOpen callback', () => {
		it('calls onOpen when overlay becomes visible', () => {
			const openSpy = vi.fn()
			sut.onOpen = openSpy
			sut.active = true
			sut.attached()

			expect(openSpy).toHaveBeenCalledOnce()
		})
	})

	describe('tap to dismiss', () => {
		it('starts fade-out on tap when visible', () => {
			// Mock reduced motion to false
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: false,
			} as MediaQueryList)

			sut.active = true
			sut.attached()
			sut.onTap()

			expect(sut.fadingOut).toBe(true)
			expect(sut.overlayState).toBe('exiting')
		})

		it('dismisses immediately with reduced motion', () => {
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: true,
			} as MediaQueryList)

			const dismissedSpy = vi.fn()
			sut.onDismissed = dismissedSpy
			sut.active = true
			sut.attached()

			sut.onTap()

			expect(sut.visible).toBe(false)
			expect(sut.fadingOut).toBe(false)
			expect(dismissedSpy).toHaveBeenCalledOnce()
		})

		it('ignores tap when not visible', () => {
			sut.onTap()

			expect(sut.fadingOut).toBe(false)
		})

		it('ignores tap when already fading out', () => {
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: false,
			} as MediaQueryList)

			sut.active = true
			sut.attached()
			sut.onTap()
			sut.onTap()

			// fadingOut should still be true (not re-triggered)
			expect(sut.fadingOut).toBe(true)
		})
	})

	describe('attached lifecycle', () => {
		it('registers transitionend listener', () => {
			sut.attached()

			expect(fakeHost.addEventListener).toHaveBeenCalledWith(
				'transitionend',
				expect.any(Function),
			)
		})
	})

	describe('detaching lifecycle', () => {
		it('removes transitionend listener', () => {
			sut.attached()
			sut.detaching()

			expect(fakeHost.removeEventListener).toHaveBeenCalledWith(
				'transitionend',
				expect.any(Function),
			)
		})

		it('calls onDismissed if still fading out', () => {
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: false,
			} as MediaQueryList)

			const dismissedSpy = vi.fn()
			sut.onDismissed = dismissedSpy
			sut.active = true
			sut.attached()
			sut.onTap()

			sut.detaching()

			expect(dismissedSpy).toHaveBeenCalledOnce()
		})
	})
})
