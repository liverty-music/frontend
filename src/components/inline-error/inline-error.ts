import { bindable } from 'aurelia'

/**
 * Reusable inline error display for use inside promise.bind catch blocks.
 * Shows an error message with a retry button.
 */
export class InlineError {
	@bindable public error: unknown
	@bindable public retryAction: (() => void) | undefined
	@bindable public message = 'Failed to load data'

	public get errorMessage(): string {
		if (this.error instanceof Error) {
			return this.error.message
		}
		return String(this.error ?? this.message)
	}

	public retry(): void {
		this.retryAction?.()
	}
}
