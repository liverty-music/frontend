import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The item's host element: the popover, with the exit motion it plays. */
const host = {
	showPopover: vi.fn(),
	hidePopover: vi.fn(),
	getAnimations: vi.fn((): Array<{ finished: Promise<unknown> }> => []),
	dispatchEvent: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return { ...actual, resolve: vi.fn(() => host) }
})

import { Snack, type SnackOptions } from './snack'
import { SnackItem } from './snack-item'

const SPEC = 'components/infrastructure/fan/web/global/snack-bar'

describe('SnackItem', () => {
	let sut: SnackItem
	let dismiss: ReturnType<typeof vi.fn<() => void>>

	/** Show `message` as the snack bar would, with a handle that records dismisses. */
	function show(message: string, options?: SnackOptions): Snack {
		const snack = new Snack(message, 'info', options)
		dismiss = vi.fn(() => {
			sut.leaving = true
			// @ts-expect-error -- the bindable's change callback, as Aurelia calls it
			sut.leavingChanged(true)
		})
		snack.handle = { dismiss }
		sut.snack = snack
		sut.attached()
		return snack
	}

	/** Advance to just before `ms` and to `ms`, reporting whether it was dismissed. */
	function dismissedAround(ms: number): [boolean, boolean] {
		vi.advanceTimersByTime(ms - 1)
		const before = dismiss.mock.calls.length > 0
		vi.advanceTimersByTime(1)
		return [before, dismiss.mock.calls.length > 0]
	}

	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		host.getAnimations.mockReturnValue([])
		sut = new SnackItem()
	})

	afterEach(() => {
		sut.detaching()
		vi.useRealTimers()
	})

	// @spec components/infrastructure/fan/web/global/snack-bar "Snack display on event publish"
	it('shows its popover when attached', () => {
		show('Hello')
		expect(host.showPopover).toHaveBeenCalledOnce()
	})

	describe('display time', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "Auto-dismiss after duration"
		it(`@spec ${SPEC} "Short message"`, () => {
			const message = 'パスキーを追加しました。'
			expect([...message]).toHaveLength(12)
			show(message)
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		it('keeps the short duration up to 30 characters', () => {
			show('あ'.repeat(30))
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		it(`@spec ${SPEC} "Long message"`, () => {
			show('あ'.repeat(50))
			expect(dismissedAround(10000)).toEqual([false, true])
		})

		it('counts characters as shown, not UTF-16 units', () => {
			// 30 emoji are 60 UTF-16 units but 30 characters.
			show('🎫'.repeat(30))
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		it('keeps a snack with an action for 10 s', () => {
			show('Undo?', { action: { label: 'Undo', callback: vi.fn() } })
			expect(dismissedAround(10000)).toEqual([false, true])
		})

		it(`@spec ${SPEC} "Snack with its own duration"`, () => {
			show('Update available', { duration: Number.POSITIVE_INFINITY })
			vi.advanceTimersByTime(600_000)
			expect(dismiss).not.toHaveBeenCalled()
		})
	})

	describe('holding', () => {
		it(`@spec ${SPEC} "Holding pauses the timer"`, () => {
			show('パスキーを追加しました。')
			vi.advanceTimersByTime(3000)
			sut.onPointerDown()
			vi.advanceTimersByTime(5000)
			expect(dismiss).not.toHaveBeenCalled()
			window.dispatchEvent(new Event('pointerup'))
			expect(dismissedAround(1000)).toEqual([false, true])
		})

		it('resumes when the pointer is released off the snack', () => {
			show('パスキーを追加しました。')
			sut.onPointerDown()
			vi.advanceTimersByTime(10_000)
			expect(dismiss).not.toHaveBeenCalled()
			// Released elsewhere on the page.
			window.dispatchEvent(new Event('pointerup'))
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		it('keeps the timer paused while a swipe scrolls after the touch was taken over', () => {
			show('パスキーを追加しました。')
			sut.onPointerDown()
			sut.onScroll()
			// The browser takes a touch over for scrolling with pointercancel.
			window.dispatchEvent(new Event('pointercancel'))
			vi.advanceTimersByTime(10_000)
			expect(dismiss).not.toHaveBeenCalled()
			sut.onScrollEnd()
			expect(dismissedAround(4000)).toEqual([false, true])
		})
	})

	describe('swipe', () => {
		it('dismisses once a swipe has carried the snack out of its place', () => {
			show('Saved')
			sut.onPointerDown()
			sut.updateVisibility(0.6)
			expect(dismiss).not.toHaveBeenCalled()
			sut.updateVisibility(0.05)
			expect(dismiss).toHaveBeenCalledOnce()
		})

		it('ignores a scroll position nobody swiped (the initial centring)', () => {
			show('Saved')
			sut.updateVisibility(0)
			expect(dismiss).not.toHaveBeenCalled()
		})
	})

	describe('actions', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "Snack action button"
		it('calls the action callback and dismisses', () => {
			const callback = vi.fn()
			show('undo', { action: { label: 'Undo', callback } })
			sut.onAction()
			expect(callback).toHaveBeenCalledOnce()
			expect(dismiss).toHaveBeenCalledOnce()
		})

		it('dismisses on the close button', () => {
			show('Saved')
			sut.onClose()
			expect(dismiss).toHaveBeenCalledOnce()
		})
	})

	describe('leaving', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "DOM cleanup after exit transition"
		it('reports the exit only after the exit motion has ended', async () => {
			show('Saved')
			// The 500 ms exit transition ends 490 ms after hidePopover().
			host.getAnimations.mockReturnValue([
				{ finished: new Promise((r) => setTimeout(r, 490)) },
			])
			sut.onClose()

			expect(host.hidePopover).toHaveBeenCalledOnce()
			await vi.advanceTimersByTimeAsync(100)
			expect(host.dispatchEvent).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(390)
			expect(host.dispatchEvent).toHaveBeenCalledOnce()
			expect(host.dispatchEvent.mock.calls[0][0].type).toBe('snack-exited')
		})

		// @spec components/infrastructure/fan/web/global/snack-bar "Reduced motion preference"
		it('reports the exit at once when no motion plays', async () => {
			show('Saved')
			sut.onClose()
			await vi.advanceTimersByTimeAsync(0)
			expect(host.dispatchEvent).toHaveBeenCalledOnce()
		})

		it('stops its timer when it leaves', () => {
			show('Saved')
			sut.leaving = true
			// @ts-expect-error -- the bindable's change callback, as Aurelia calls it
			sut.leavingChanged(true)
			vi.advanceTimersByTime(10_000)
			expect(dismiss).not.toHaveBeenCalled()
		})
	})
})
