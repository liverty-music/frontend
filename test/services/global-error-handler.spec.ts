import { IAppTask } from '@aurelia/runtime-html'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AppError,
	IErrorBoundaryService,
} from '../../src/services/error-boundary-service'
import {
	GlobalErrorHandlingTask,
	isExtensionError,
} from '../../src/services/global-error-handler'

const BANNER_SPEC = 'components/infrastructure/fan/web/global/error-banner'

describe('GlobalErrorHandlingTask', () => {
	let captureError: ReturnType<typeof vi.fn>
	let rejectionListeners: EventListener[]
	let originalOnError: OnErrorEventHandler

	/** Runs the AppTask the way Aurelia does at `creating`. */
	function start(): void {
		const container = DI.createContainer()
		container.register(
			Registration.instance(IErrorBoundaryService, { captureError }),
		)
		GlobalErrorHandlingTask.register(container)
		for (const task of container.getAll(IAppTask)) void task.run()
	}

	/** What the browser does for an unhandled error. */
	function raise(
		message: string,
		source?: string,
		error?: Error,
	): boolean | undefined {
		return window.onerror?.(message, source, 12, 34, error) as
			| boolean
			| undefined
	}

	/** What the browser does for an unhandled rejection. */
	function reject(reason: unknown): Event {
		const event = Object.assign(
			new Event('unhandledrejection', { cancelable: true }),
			{ reason },
		)
		window.dispatchEvent(event)
		return event
	}

	beforeEach(() => {
		captureError = vi.fn()
		originalOnError = window.onerror
		window.onerror = null
		rejectionListeners = []
		const add = window.addEventListener.bind(window)
		vi.spyOn(window, 'addEventListener').mockImplementation(
			(type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === 'unhandledrejection') {
					rejectionListeners.push(listener as EventListener)
				}
				add(type, listener)
			},
		)
	})

	afterEach(() => {
		for (const listener of rejectionListeners) {
			window.removeEventListener('unhandledrejection', listener)
		}
		window.onerror = originalOnError
		vi.restoreAllMocks()
	})

	it(`@spec ${BANNER_SPEC} "Unhandled synchronous error is caught"`, () => {
		start()
		const err = new Error('boom')

		const handled = raise('Uncaught Error: boom', 'https://app/x.js', err)

		expect(captureError).toHaveBeenCalledWith(err, 'unhandled_error')
		// `false` keeps the browser's own console log.
		expect(handled).toBe(false)
		// The Error ID is generated from the captured value.
		expect(new AppError(err, 'unhandled_error').id).toMatch(/^ERR-[0-9a-f]{8}$/)
	})

	it(`@spec ${BANNER_SPEC} "Unhandled promise rejection is caught"`, () => {
		start()
		const reason = { code: 3 }

		const event = reject(reason)

		// The reason as it was rejected, not a string.
		expect(captureError).toHaveBeenCalledWith(reason, 'unhandled_rejection')
		// No preventDefault(): the browser still logs the rejection.
		expect(event.defaultPrevented).toBe(false)
	})

	it(`@spec ${BANNER_SPEC} "An earlier error handler keeps working"`, () => {
		const earlier = vi.fn()
		window.onerror = earlier
		start()
		const err = new Error('boom')

		raise('Uncaught Error: boom', 'https://app/x.js', err)

		expect(earlier).toHaveBeenCalledWith(
			'Uncaught Error: boom',
			'https://app/x.js',
			12,
			34,
			err,
		)
		expect(captureError).toHaveBeenCalledWith(err, 'unhandled_error')
	})

	it('still captures when the earlier handler throws', () => {
		window.onerror = () => {
			throw new Error('other script')
		}
		start()

		expect(() =>
			raise('Uncaught Error: boom', undefined, new Error('boom')),
		).not.toThrow()
		expect(captureError).toHaveBeenCalledOnce()
	})

	it(`@spec ${BANNER_SPEC} "Error without an error object keeps its location"`, () => {
		start()

		raise('Script error.', 'https://cdn.example/lib.js')

		const [value, source] = captureError.mock.calls[0]
		expect(source).toBe('unhandled_error')
		expect(value).toBeInstanceOf(ErrorEvent)
		expect(value).toMatchObject({
			message: 'Script error.',
			filename: 'https://cdn.example/lib.js',
			lineno: 12,
			colno: 34,
		})
		const appError = new AppError(value, 'unhandled_error')
		expect(appError.message).toBe('Script error.')
		expect(appError.stack).toBe('at https://cdn.example/lib.js:12:34')
	})

	it(`@spec ${BANNER_SPEC} "Error raised by a browser extension"`, () => {
		start()
		const fromExtension = new Error('ext')
		fromExtension.stack =
			'Error: ext\n    at run (chrome-extension://abcdef/content.js:1:2)'

		raise('Uncaught Error: ext', 'chrome-extension://abcdef/content.js')
		reject(fromExtension)

		expect(captureError).not.toHaveBeenCalled()
	})

	it('never throws when capture throws', () => {
		captureError.mockImplementation(() => {
			throw new Error('capture')
		})
		start()

		expect(raise('x', undefined, new Error('x'))).toBe(false)
		expect(() => reject(new Error('x'))).not.toThrow()
	})
})

describe('isExtensionError', () => {
	it.each([
		['chrome', 'at run (chrome-extension://id/a.js:1:2)'],
		['firefox', 'run@moz-extension://id/a.js:1:2'],
		['safari', 'run@safari-web-extension://id/a.js:1:2'],
	])('detects the %s extension frame at the top of the stack', (_, frame) => {
		const err = new Error('x')
		err.stack = `Error: x\n    ${frame}`
		expect(isExtensionError(err)).toBe(true)
	})

	it('does not flag the app’s own frames', () => {
		const err = new Error('x')
		err.stack = 'Error: x\n    at run (https://liverty-music.app/a.js:1:2)'
		expect(isExtensionError(err)).toBe(false)
		expect(isExtensionError({ code: 3 })).toBe(false)
	})
})
