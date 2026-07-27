import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => mockLogger),
	}
})

import { ResumeRevalidator } from './resume-revalidator'

function fireVisible(): void {
	document.dispatchEvent(new Event('visibilitychange'))
}

describe('ResumeRevalidator', () => {
	let sut: ResumeRevalidator

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new ResumeRevalidator()
	})

	it('invokes the active route callback on foreground return', () => {
		const revalidate = vi.fn()
		sut.register(revalidate)

		fireVisible()

		// jsdom reports visibilityState 'visible', so the resume path fires.
		expect(revalidate).toHaveBeenCalledTimes(1)
	})

	it('only fans out to the most recently registered (active) route', () => {
		const first = vi.fn()
		const second = vi.fn()
		sut.register(first)
		sut.register(second) // route transition: new active route

		fireVisible()

		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledTimes(1)
	})

	it('does not fire after the active route unregisters', () => {
		const revalidate = vi.fn()
		sut.register(revalidate)
		sut.unregister(revalidate)

		fireVisible()

		expect(revalidate).not.toHaveBeenCalled()
	})

	it('swallows a throwing callback so resume never crashes the app', () => {
		sut.register(() => {
			throw new Error('boom')
		})

		expect(() => fireVisible()).not.toThrow()
	})
})
