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
		it('dismisses after 2500 ms by default', () => {
			sut.attaching()
			subscribeHandler?.(new Snack('saved'))

			vi.advanceTimersByTime(2499)
			expect(sut.snacks[0].dismissed).toBe(false)
			vi.advanceTimersByTime(1)
			expect(sut.snacks[0].dismissed).toBe(true)
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
})
