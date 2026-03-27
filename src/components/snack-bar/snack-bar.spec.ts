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
