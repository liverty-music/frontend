import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenWakeLock } from '../../../src/adapter/browser/screen-wake-lock'
import { createTestContainer } from '../../helpers/create-container'

interface FakeSentinel {
	released: boolean
	release: ReturnType<typeof vi.fn>
}

function fakeSentinel(): FakeSentinel {
	const s: FakeSentinel = {
		released: false,
		release: vi.fn(async () => {
			s.released = true
		}),
	}
	return s
}

function setVisibility(state: 'visible' | 'hidden'): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state,
	})
	document.dispatchEvent(new Event('visibilitychange'))
}

describe('ScreenWakeLock', () => {
	let request: ReturnType<typeof vi.fn>
	let sentinels: FakeSentinel[]

	function build(): ScreenWakeLock {
		const container = createTestContainer()
		container.register(Registration.transient(ScreenWakeLock, ScreenWakeLock))
		return container.get(ScreenWakeLock)
	}

	beforeEach(() => {
		sentinels = []
		request = vi.fn(async () => {
			const s = fakeSentinel()
			sentinels.push(s)
			return s
		})
		Object.defineProperty(navigator, 'wakeLock', {
			configurable: true,
			value: { request },
		})
	})

	afterEach(() => {
		Reflect.deleteProperty(navigator, 'wakeLock')
		setVisibility('visible')
	})

	it('holds the screen lock and takes it again when the page comes back', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Screen stays on"
		const lock = build()
		await lock.acquire()
		expect(request).toHaveBeenCalledWith('screen')
		expect(lock.held).toBe(true)

		// The browser releases the lock when the page is hidden …
		sentinels[0].released = true
		setVisibility('hidden')
		expect(lock.held).toBe(false)
		// … and it is requested again when the page is visible.
		setVisibility('visible')
		await vi.waitFor(() => expect(lock.held).toBe(true))
		expect(request).toHaveBeenCalledTimes(2)

		await lock.release()
		expect(sentinels[1].release).toHaveBeenCalled()
		expect(lock.held).toBe(false)
		setVisibility('visible')
		expect(request).toHaveBeenCalledTimes(2)
	})

	it('ignores a refused request', async () => {
		request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
		const lock = build()
		await expect(lock.acquire()).resolves.toBeUndefined()
		expect(lock.held).toBe(false)
		await lock.release()
	})

	it('does nothing where the API is missing', async () => {
		Reflect.deleteProperty(navigator, 'wakeLock')
		const lock = build()
		await lock.acquire()
		expect(lock.held).toBe(false)
		await lock.release()
	})

	it('releases a lock granted after release was asked', async () => {
		let grant: (s: FakeSentinel) => void = () => {}
		request.mockImplementationOnce(
			() =>
				new Promise<FakeSentinel>((r) => {
					grant = r
				}),
		)
		const lock = build()
		const acquiring = lock.acquire()
		await lock.release()
		const late = fakeSentinel()
		grant(late)
		await acquiring
		expect(late.release).toHaveBeenCalled()
		expect(lock.held).toBe(false)
	})
})
