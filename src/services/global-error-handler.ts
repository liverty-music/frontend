import { AppTask } from 'aurelia'
import { IErrorBoundaryService } from './error-boundary-service'

/** Address prefixes of browser-extension code (OpenSpec `global/error-banner`). */
const EXTENSION_PREFIXES = [
	'chrome-extension://',
	'moz-extension://',
	'safari-extension:',
	'safari-web-extension:',
]

const isExtensionAddress = (address: string): boolean =>
	EXTENSION_PREFIXES.some((prefix) => address.startsWith(prefix))

/**
 * The address of the top stack frame of `value`, if it has a stack. Chrome
 * and Firefox put the address after `at ` / `@`, optionally in parentheses.
 */
function topFrameAddress(value: unknown): string | undefined {
	const stack = (value as { stack?: unknown } | null)?.stack
	if (typeof stack !== 'string') return undefined
	for (const line of stack.split('\n')) {
		const match = /(?:\bat\s+(?:.*?\()?|@)([a-z-]+:[^\s)]+)/.exec(line)
		if (match) return match[1]
	}
	return undefined
}

/** True when the error was raised by a browser extension's code. */
export function isExtensionError(value: unknown, filename?: string): boolean {
	if (filename !== undefined && isExtensionAddress(filename)) return true
	const top = topFrameAddress(value)
	return top !== undefined && isExtensionAddress(top)
}

/**
 * Aurelia 2 AppTask that registers global error handlers during application startup.
 * Catches unhandled synchronous errors and unhandled promise rejections,
 * forwarding them to ErrorBoundaryService.
 *
 * Follows what posthog-js's own exception autocapture does: an earlier
 * `window.onerror` keeps working, the browser still logs the error, and the
 * original value is passed on so its cause chain survives.
 */
export const GlobalErrorHandlingTask = AppTask.creating(
	IErrorBoundaryService,
	(errorBoundary) => {
		const previous = window.onerror
		window.onerror = (
			message: string | Event,
			source?: string,
			lineno?: number,
			colno?: number,
			error?: Error,
		) => {
			try {
				previous?.call(window, message, source, lineno, colno, error)
			} catch {
				// Another script's handler must not stop our capture.
			}
			try {
				if (!isExtensionError(error, source)) {
					// Without an error object (a cross-origin "Script error.", for
					// example) keep the message and location as an ErrorEvent, which
					// both AppError and the error report read.
					errorBoundary.captureError(
						error ??
							new ErrorEvent('error', {
								message: typeof message === 'string' ? message : message.type,
								filename: source,
								lineno,
								colno,
							}),
						'unhandled_error',
					)
				}
			} catch {
				// The handler never throws.
			}
			// Returning false keeps the browser's own console log.
			return false
		}

		window.addEventListener(
			'unhandledrejection',
			(event: PromiseRejectionEvent) => {
				try {
					if (!isExtensionError(event.reason)) {
						errorBoundary.captureError(event.reason, 'unhandled_rejection')
					}
				} catch {
					// The handler never throws.
				}
			},
		)
	},
)
