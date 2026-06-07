import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLogger = { warn: vi.fn(), scopeTo: vi.fn() }
fakeLogger.scopeTo.mockReturnValue(fakeLogger)

// A real DOM element so the attribute can attach listeners and toggle attributes.
let element: HTMLButtonElement

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token) => {
			const name = String(token)
			if (name.includes('Logger')) return fakeLogger
			// The only other dependency the attribute resolves is INode.
			return element
		}),
	}
})

import { BusyOnClickCustomAttribute } from './busy-on-click'

/** Resolves on the next microtask so awaited promises inside the handler settle. */
const flush = (): Promise<void> => Promise.resolve()

describe('BusyOnClickCustomAttribute', () => {
	let sut: BusyOnClickCustomAttribute

	beforeEach(() => {
		vi.clearAllMocks()
		fakeLogger.scopeTo.mockReturnValue(fakeLogger)
		element = document.createElement('button')
		sut = new BusyOnClickCustomAttribute()
		sut.attached()
	})

	afterEach(() => {
		sut.detaching()
	})

	it('marks the element busy while the handler promise is in flight, then clears it', async () => {
		let resolveHandler: () => void = () => {}
		const handler = vi.fn(
			() =>
				new Promise<void>((res) => {
					resolveHandler = res
				}),
		)
		sut.value = handler

		element.click()
		await flush()

		expect(handler).toHaveBeenCalledOnce()
		expect(element.hasAttribute('data-busy')).toBe(true)
		expect(element.getAttribute('aria-busy')).toBe('true')

		resolveHandler()
		await flush()
		await flush()

		expect(element.hasAttribute('data-busy')).toBe(false)
		expect(element.hasAttribute('aria-busy')).toBe(false)
	})

	it('ignores re-entrant clicks while busy (double-tap guard)', async () => {
		const handler = vi.fn(() => new Promise<void>(() => {}))
		sut.value = handler

		element.click()
		element.click()
		element.click()
		await flush()

		expect(handler).toHaveBeenCalledOnce()
	})

	it('does not enter busy state for a synchronous / non-thenable handler', async () => {
		const handler = vi.fn(() => undefined)
		sut.value = handler

		element.click()
		await flush()

		expect(handler).toHaveBeenCalledOnce()
		expect(element.hasAttribute('data-busy')).toBe(false)
		expect(element.hasAttribute('aria-busy')).toBe(false)
	})

	it('clears busy state and logs a warning when the handler rejects', async () => {
		const error = new Error('boom')
		const handler = vi.fn(() => Promise.reject(error))
		sut.value = handler

		element.click()
		await flush()
		await flush()

		expect(element.hasAttribute('data-busy')).toBe(false)
		expect(element.hasAttribute('aria-busy')).toBe(false)
		expect(fakeLogger.warn).toHaveBeenCalledWith(
			'busy-on-click handler rejected',
			{ error },
		)
	})

	it('removes the click listener on detach', async () => {
		const handler = vi.fn(() => Promise.resolve())
		sut.value = handler
		sut.detaching()

		element.click()
		await flush()

		expect(handler).not.toHaveBeenCalled()
	})

	it('does nothing when no handler is bound', async () => {
		sut.value = null

		expect(() => element.click()).not.toThrow()
		await flush()
		expect(element.hasAttribute('data-busy')).toBe(false)
	})
})
