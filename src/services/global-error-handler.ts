import { AppTask } from 'aurelia'
import { IErrorBoundaryService } from './error-boundary-service'

/**
 * Aurelia 2 AppTask that registers global error handlers during application startup.
 * Catches unhandled synchronous errors and unhandled promise rejections,
 * forwarding them to ErrorBoundaryService.
 */
export const GlobalErrorHandlingTask = AppTask.creating(
	IErrorBoundaryService,
	(errorBoundary) => {
		window.onerror = (
			_message: string | Event,
			_source?: string,
			_lineno?: number,
			_colno?: number,
			error?: Error,
		) => {
			errorBoundary.captureError(error ?? _message, 'window.onerror')
			return true
		}

		window.addEventListener(
			'unhandledrejection',
			(event: PromiseRejectionEvent) => {
				errorBoundary.captureError(event.reason, 'unhandledrejection')
				event.preventDefault()
			},
		)
	},
)
