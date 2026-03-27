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

const fakeOnboarding = {
	onBringToFront: undefined as (() => void) | undefined,
}

describe('CoachMark', () => {
	let sut: CoachMark

	beforeEach(() => {
		fakeOnboarding.onBringToFront = undefined
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

	describe('onTap callback', () => {
		it('invokes onTap when onBlockerClick is called', () => {
			const tapSpy = vi.fn()
			sut.onTap = tapSpy

			sut.onBlockerClick()

			expect(tapSpy).toHaveBeenCalledOnce()
		})

		it('does not throw when onTap is not set', () => {
			sut.onTap = undefined

			expect(() => sut.onBlockerClick()).not.toThrow()
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

	describe('bound lifecycle', () => {
		it('registers onBringToFront callback', () => {
			sut.bound()

			expect(fakeOnboarding.onBringToFront).toBeDefined()
		})
	})

	describe('detaching lifecycle', () => {
		it('unregisters onBringToFront callback', () => {
			sut.bound()
			sut.detaching()

			expect(fakeOnboarding.onBringToFront).toBeUndefined()
		})

		it('sets visible to false', () => {
			sut.visible = true
			sut.detaching()

			expect(sut.visible).toBe(false)
		})
	})
})
