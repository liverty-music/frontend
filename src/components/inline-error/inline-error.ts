import { bindable } from 'aurelia'

/**
 * Reusable inline error display for use inside promise.bind catch blocks.
 * Shows the caller's message, translated by the caller from the catalog, with
 * a retry button. It never shows the error's own text: that is written for
 * developers and stays in the caller's console log.
 */
export class InlineError {
	@bindable public retryAction: (() => void) | undefined
	@bindable public message = ''

	public retry(): void {
		this.retryAction?.()
	}
}
