import { bindable } from 'aurelia'
import type { ConsoleIconName } from '../console-icon/console-icon'

export type ConsoleButtonVariant =
	| 'filled'
	| 'tonal'
	| 'outlined'
	| 'text'
	| 'danger'

/**
 * M3 common button. `filled` is the page's one primary action and the only
 * variant in the brand color.
 *
 * With `action`, the button runs it on press and, while the returned promise
 * is pending, shows a progress indicator in place of its icon with
 * `pending-label`, keeps its size and ignores further presses. Screens hand the
 * button their action instead of guarding repeats themselves.
 *
 * With `href`, the button is a link (navigation, not an action).
 */
export class ConsoleButton {
	@bindable public variant: ConsoleButtonVariant = 'outlined'
	@bindable public icon: ConsoleIconName | '' = ''
	@bindable public action: (() => unknown) | undefined
	@bindable public pendingLabel = ''
	@bindable public disabled = false
	@bindable public href = ''
	/** `_blank` opens the link in a new tab (with `noopener`). */
	@bindable public target = ''
	@bindable public type: 'button' | 'submit' = 'button'

	/** True while `action` runs. A parent may bind it to disable related controls. */
	@bindable public pending = false

	public async press(event: Event): Promise<void> {
		if (this.pending || this.disabled) {
			event.preventDefault()
			return
		}
		if (!this.action) return
		this.pending = true
		try {
			await this.action()
		} finally {
			this.pending = false
		}
	}
}
