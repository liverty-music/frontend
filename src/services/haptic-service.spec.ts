import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLogger = { debug: vi.fn(), scopeTo: vi.fn() }
fakeLogger.scopeTo.mockReturnValue(fakeLogger)

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => fakeLogger),
	}
})

import { HapticService } from './haptic-service'

describe('HapticService', () => {
	const nav = navigator as unknown as {
		vibrate?: (pattern: number | number[]) => boolean
	}
	const hadVibrate = 'vibrate' in navigator
	const originalVibrate = nav.vibrate

	beforeEach(() => {
		vi.clearAllMocks()
		fakeLogger.scopeTo.mockReturnValue(fakeLogger)
	})

	afterEach(() => {
		if (hadVibrate) {
			nav.vibrate = originalVibrate
		} else {
			delete nav.vibrate
		}
	})

	it('calls navigator.vibrate with the tap/confirm durations where supported', () => {
		const vibrate = vi.fn()
		nav.vibrate = vibrate
		const sut = new HapticService()

		sut.tap()
		expect(vibrate).toHaveBeenCalledWith(10)

		sut.confirm()
		expect(vibrate).toHaveBeenCalledWith(20)
	})

	it('is a silent no-op when the Vibration API is unavailable', () => {
		delete nav.vibrate
		const sut = new HapticService()

		expect(() => {
			sut.tap()
			sut.confirm()
			sut.pulse([10, 20])
		}).not.toThrow()
	})

	it('swallows a vibrate that throws (platform-blocked)', () => {
		nav.vibrate = vi.fn(() => {
			throw new Error('blocked')
		})
		const sut = new HapticService()

		expect(() => sut.confirm()).not.toThrow()
		expect(fakeLogger.debug).toHaveBeenCalledWith('vibrate blocked', {
			error: expect.any(Error),
		})
	})
})
