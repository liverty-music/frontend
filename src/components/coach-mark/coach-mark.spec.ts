import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Uses DI Unit test pattern (vi.mock) instead of createFixture for consistency
// with other Layer 2 component tests that depend on browser-only APIs (popover,
// View Transitions, CSS Anchor Positioning). The coach-mark component itself
// uses all three in its highlight() method.
vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			if (token === actual.ILogger) return fakeLogger
			return fakeOnboarding
		}),
		bindable: actual.bindable,
	}
})

import { CoachMark } from './coach-mark'

const fakeLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	scopeTo: vi.fn(() => fakeLogger),
}

const fakeOnboarding = {}

describe('CoachMark', () => {
	let sut: CoachMark

	beforeEach(() => {
		sut = new CoachMark()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('visible state', () => {
		it('defaults to not visible', () => {
			expect(sut.visible).toBe(false)
		})

		it('sets visible to false on deactivate', () => {
			sut.visible = true
			sut.deactivate()

			expect(sut.visible).toBe(false)
		})
	})

	describe('keyboard handler', () => {
		it('invokes onTap on Enter key', () => {
			const tapSpy = vi.fn()
			sut.onTap = tapSpy

			const event = new KeyboardEvent('keydown', { key: 'Enter' })
			vi.spyOn(event, 'preventDefault')
			sut.onKeydown(event)

			expect(tapSpy).toHaveBeenCalledOnce()
			expect(event.preventDefault).toHaveBeenCalled()
		})

		it('invokes onTap on Space key', () => {
			const tapSpy = vi.fn()
			sut.onTap = tapSpy

			const event = new KeyboardEvent('keydown', { key: ' ' })
			sut.onKeydown(event)

			expect(tapSpy).toHaveBeenCalledOnce()
		})

		it('ignores other keys', () => {
			const tapSpy = vi.fn()
			sut.onTap = tapSpy

			sut.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))

			expect(tapSpy).not.toHaveBeenCalled()
		})
	})

	describe('target click', () => {
		it('invokes onTap and prevents default', () => {
			const tapSpy = vi.fn()
			sut.onTap = tapSpy

			const event = new Event('click')
			vi.spyOn(event, 'preventDefault')
			vi.spyOn(event, 'stopPropagation')

			sut.onTargetClick(event)

			expect(event.preventDefault).toHaveBeenCalled()
			expect(event.stopPropagation).toHaveBeenCalled()
			expect(tapSpy).toHaveBeenCalledOnce()
		})
	})

	describe('light-dismiss (pointerdown outside the coach mark)', () => {
		type Handler = { onOutsidePointerDown: (e: PointerEvent) => void }
		const fire = (target: Node) =>
			(sut as unknown as Handler).onOutsidePointerDown({
				target,
			} as unknown as PointerEvent)

		it('invokes onDismiss and deactivates on an outside pointerdown', () => {
			const dismissSpy = vi.fn()
			sut.onDismiss = dismissSpy
			sut.visible = true
			sut.overlayEl = document.createElement('div') // contains nothing

			fire(document.createElement('div'))

			expect(dismissSpy).toHaveBeenCalledOnce()
			expect(sut.visible).toBe(false)
		})

		it('does not dismiss when the pointerdown is inside the coach mark', () => {
			const dismissSpy = vi.fn()
			sut.onDismiss = dismissSpy
			sut.visible = true
			const overlay = document.createElement('div')
			const inside = document.createElement('div')
			overlay.appendChild(inside)
			sut.overlayEl = overlay

			fire(inside)

			expect(dismissSpy).not.toHaveBeenCalled()
			expect(sut.visible).toBe(true)
		})

		it('does not throw when onDismiss is undefined', () => {
			sut.onDismiss = undefined
			sut.overlayEl = document.createElement('div')
			expect(() => fire(document.createElement('div'))).not.toThrow()
		})
	})

	describe('detaching lifecycle', () => {
		it('sets visible to false', () => {
			sut.visible = true
			sut.detaching()

			expect(sut.visible).toBe(false)
		})
	})

	describe('active/selector reactivity', () => {
		// With an empty target selector findAndHighlight() returns early after the
		// guard, so these exercise the activeChanged / bound / targetSelectorChanged
		// branches without touching DOM anchoring or the retry timer.
		it('deactivates when active flips to false', () => {
			sut.visible = true
			sut.active = false
			sut.activeChanged()

			expect(sut.visible).toBe(false)
		})

		it('attempts highlight when active flips to true', () => {
			sut.active = true
			sut.targetSelector = ''
			sut.activeChanged()

			// Empty selector → no highlight, stays not visible (guard path).
			expect(sut.visible).toBe(false)
		})

		it('attempts highlight on bound when already active', () => {
			sut.active = true
			sut.targetSelector = ''

			expect(() => sut.bound()).not.toThrow()
		})

		it('does nothing on bound when inactive', () => {
			sut.active = false

			expect(() => sut.bound()).not.toThrow()
			expect(sut.visible).toBe(false)
		})

		it('re-resolves the target when the selector changes while active', () => {
			sut.active = true
			sut.targetSelector = ''

			expect(() => sut.targetSelectorChanged()).not.toThrow()
		})
	})
})
