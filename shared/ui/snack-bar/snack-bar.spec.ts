import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeSubscription = { dispose: vi.fn() }
let subscribeHandler: ((e: unknown) => void) | undefined
const fakeEa = {
	subscribe: vi.fn((_channel: unknown, handler: (e: unknown) => void) => {
		subscribeHandler = handler
		return fakeSubscription
	}),
	publish: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakeEa),
	}
})

import { Snack } from './snack'
import { SnackBar } from './snack-bar'

describe('SnackBar', () => {
	let sut: SnackBar

	beforeEach(() => {
		vi.useFakeTimers()
		subscribeHandler = undefined
		vi.clearAllMocks()
		sut = new SnackBar()
		Object.defineProperty(sut, 'containerElement', {
			value: {
				querySelector: vi.fn(() => ({
					showPopover: vi.fn(),
					hidePopover: vi.fn(),
				})),
			},
			writable: true,
		})
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('attaching', () => {
		it('subscribes to Snack events', () => {
			sut.attaching()

			expect(fakeEa.subscribe).toHaveBeenCalledWith(Snack, expect.any(Function))
		})
	})

	describe('detaching', () => {
		it('disposes subscription', () => {
			sut.attaching()
			sut.detaching()

			expect(fakeSubscription.dispose).toHaveBeenCalledOnce()
		})
	})

	describe('show', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "Snack display on event publish"
		it('adds snack to the list on event', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('Hello', 'info', { duration: 3000 }))
			// Flush microtask for showPopover
			vi.advanceTimersByTime(0)

			expect(sut.snacks).toHaveLength(1)
			expect(sut.snacks[0].message).toBe('Hello')
		})

		it('assigns sequential IDs', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('first', 'info', { duration: 3000 }))
			subscribeHandler?.(new Snack('second', 'info', { duration: 3000 }))

			expect(sut.snacks[0].id).toBe(0)
			expect(sut.snacks[1].id).toBe(1)
		})
	})

	describe('icon', () => {
		it('shows the severity icon by default', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('Saved', 'warning', { duration: 3000 }))

			expect(sut.snacks[0].icon).toBe('warning')
		})

		it('shows a custom icon instead of the severity icon', () => {
			sut.attaching()
			subscribeHandler?.(
				new Snack('Update available', 'info', {
					duration: 3000,
					icon: 'rotate-ccw',
				}),
			)

			expect(sut.snacks[0].icon).toBe('rotate-ccw')
		})

		// @spec components/infrastructure/fan/web/global/snack-bar "No leading icon"
		it('shows no icon when the snack asks for none', () => {
			sut.attaching()
			subscribeHandler?.(
				new Snack('Update available', 'info', { duration: 3000, icon: null }),
			)

			expect(sut.snacks[0].icon).toBe('')
		})

		it('carries the attention flag to the shown snack', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('Plain', 'info', { duration: 3000 }))
			subscribeHandler?.(
				new Snack('Update', 'info', { duration: 3000, attention: true }),
			)

			expect(sut.snacks.map((s) => s.attention)).toEqual([false, true])
		})
	})

	describe('replace', () => {
		it('stacks snacks by default', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('first'))
			subscribeHandler?.(new Snack('second'))

			expect(sut.snacks.map((s) => s.dismissed)).toEqual([false, false])
		})

		it('dismisses the shown snack when a new one arrives', () => {
			const onDismiss = vi.fn()
			sut.replace = true
			sut.attaching()
			subscribeHandler?.(new Snack('saved', 'info', { onDismiss }))
			subscribeHandler?.(new Snack('copied'))

			expect(onDismiss).toHaveBeenCalledOnce()
			expect(sut.snacks.filter((s) => !s.dismissed)).toHaveLength(1)
			expect(sut.snacks.find((s) => !s.dismissed)?.message).toBe('copied')
		})
	})

	describe('duration', () => {
		/** Advance to just before `ms` and to `ms`, reporting dismissed state. */
		function dismissedAround(ms: number): [boolean, boolean] {
			vi.advanceTimersByTime(ms - 1)
			const before = sut.snacks[0].dismissed
			vi.advanceTimersByTime(1)
			return [before, sut.snacks[0].dismissed]
		}

		// @spec components/infrastructure/fan/web/global/snack-bar "Auto-dismiss after duration"
		// @spec components/infrastructure/fan/web/global/snack-bar "Short message"
		it('dismisses a short message without an action after 4 s', () => {
			sut.attaching()
			const message = 'パスキーを追加しました。'
			expect([...message]).toHaveLength(12)
			subscribeHandler?.(new Snack(message))
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		it('keeps the short duration up to 30 characters', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('あ'.repeat(30)))
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		// @spec components/infrastructure/fan/web/global/snack-bar "Long message"
		it('dismisses a message longer than 30 characters after 10 s', () => {
			sut.attaching()
			const message = 'あ'.repeat(50)
			subscribeHandler?.(new Snack(message))
			expect(dismissedAround(10000)).toEqual([false, true])
		})

		it('counts characters as shown, not UTF-16 units', () => {
			// 30 emoji are 60 UTF-16 units but 30 characters.
			sut.attaching()
			subscribeHandler?.(new Snack('🎫'.repeat(30)))
			expect(dismissedAround(4000)).toEqual([false, true])
		})

		it('keeps a snack with an action for 10 s', () => {
			sut.attaching()
			subscribeHandler?.(
				new Snack('Undo?', 'info', {
					action: { label: 'Undo', callback: vi.fn() },
				}),
			)
			expect(dismissedAround(10000)).toEqual([false, true])
		})

		// @spec components/infrastructure/fan/web/global/snack-bar "Snack with its own duration"
		it("keeps a snack's own duration", () => {
			sut.attaching()
			subscribeHandler?.(
				new Snack('long '.repeat(20), 'info', { duration: 2000 }),
			)
			subscribeHandler?.(
				new Snack('Update available', 'info', {
					duration: Number.POSITIVE_INFINITY,
					action: { label: 'Reload', callback: vi.fn() },
				}),
			)
			vi.advanceTimersByTime(2000)
			expect(sut.snacks.map((s) => s.dismissed)).toEqual([true, false])
			vi.advanceTimersByTime(60000)
			expect(sut.snacks[1].dismissed).toBe(false)
		})

		it('uses the duration of each snack', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('short', 'info', { duration: 4000 }))
			subscribeHandler?.(new Snack('long', 'info', { duration: 10000 }))
			subscribeHandler?.(
				new Snack('retry', 'error', { duration: Number.POSITIVE_INFINITY }),
			)

			vi.advanceTimersByTime(4000)
			expect(sut.snacks.map((s) => s.dismissed)).toEqual([true, false, false])
			vi.advanceTimersByTime(6000)
			expect(sut.snacks.map((s) => s.dismissed)).toEqual([true, true, false])
			vi.advanceTimersByTime(60000)
			expect(sut.snacks[2].dismissed).toBe(false)
		})
	})

	describe('onAction', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "Snack action button"
		it('calls action callback and dismisses', () => {
			const actionCallback = vi.fn()
			sut.attaching()
			subscribeHandler?.(
				new Snack('undo', 'info', {
					duration: 5000,
					action: { label: 'Undo', callback: actionCallback },
				}),
			)

			sut.onAction(sut.snacks[0])

			expect(actionCallback).toHaveBeenCalledOnce()
			expect(sut.snacks[0].dismissed).toBe(true)
		})
	})

	describe('handle', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "Programmatic dismiss via handle"
		it('dismisses at once, clears the timer and calls onDismiss once', () => {
			const onDismiss = vi.fn()
			const hidePopover = vi.fn()
			Object.defineProperty(sut, 'containerElement', {
				value: {
					querySelector: vi.fn(() => ({ showPopover: vi.fn(), hidePopover })),
				},
				writable: true,
			})
			sut.attaching()
			const event = new Snack('Saved', 'info', { duration: 5000, onDismiss })
			subscribeHandler?.(event)

			event.handle?.dismiss()
			event.handle?.dismiss()
			vi.advanceTimersByTime(5000)

			expect(hidePopover).toHaveBeenCalledOnce()
			expect(sut.snacks[0].dismissTimer).toBeNull()
			expect(onDismiss).toHaveBeenCalledOnce()
		})
	})

	describe('onToggle', () => {
		// @spec components/infrastructure/fan/web/global/snack-bar "DOM cleanup after exit transition"
		it('removes the snack when its popover reports closed', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('first', 'info', { duration: 3000 }))
			subscribeHandler?.(new Snack('second', 'info', { duration: 3000 }))
			const [first] = sut.snacks

			sut.onToggle({ newState: 'open' } as ToggleEvent, first)
			expect(sut.snacks).toHaveLength(2)
			sut.onToggle({ newState: 'closed' } as ToggleEvent, first)

			expect(sut.snacks.map((s) => s.message)).toEqual(['second'])
		})
	})
})
