import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForServiceWorkerUpdates } from './sw-update-check'

// The unit project polyfills the `process` import; the Node process that
// reports unhandled rejections is on globalThis.
const nodeProcess = (globalThis as { process: NodeJS.Process }).process

function setVisibility(state: DocumentVisibilityState): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state,
	})
	document.dispatchEvent(new Event('visibilitychange'))
}

describe('checkForServiceWorkerUpdates', () => {
	const onUnhandled = vi.fn()

	afterEach(() => {
		nodeProcess.off('unhandledRejection', onUnhandled)
		onUnhandled.mockReset()
		setVisibility('visible')
	})

	it('checks once at start and again each time the page becomes visible', () => {
		const update = vi.fn().mockResolvedValue(undefined)
		checkForServiceWorkerUpdates({ update })
		expect(update).toHaveBeenCalledTimes(1)

		setVisibility('hidden')
		expect(update).toHaveBeenCalledTimes(1)

		setVisibility('visible')
		expect(update).toHaveBeenCalledTimes(2)
	})

	it('does not leave a failed check as an unhandled rejection', async () => {
		nodeProcess.on('unhandledRejection', onUnhandled)
		// A plain function, not vi.fn(): a mock handles the promises it returns.
		let calls = 0
		const update = (): Promise<unknown> => {
			calls++
			return Promise.reject(new TypeError('Failed to update a ServiceWorker'))
		}

		checkForServiceWorkerUpdates({ update })
		setVisibility('visible')
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(calls).toBe(2)
		expect(onUnhandled).not.toHaveBeenCalled()
	})
})
