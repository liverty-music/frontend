import { bindable } from 'aurelia'
import type {
	ConsoleButton,
	ConsoleButtonVariant,
} from '../console-button/console-button'

let nextId = 0

/**
 * The element that has focus, inside the shadow roots of console components
 * (`document.activeElement` names only their outermost host).
 */
function focusedElement(): HTMLElement | null {
	let active = document.activeElement
	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement
	}
	return active instanceof HTMLElement ? active : null
}

/**
 * M3 basic dialog that asks before an action that cannot be undone or that
 * reaches people outside the console. The title names the action and its
 * object, the body states the effect, the confirming button names the action
 * and the other button is やめる (Cancel in English; `common.cancel`).
 *
 * The title and the buttons are catalog keys (with the title's values),
 * translated in the dialog's template; the body is the page's own content.
 *
 * Built on the native `<dialog>` with `showModal()`: the platform traps focus
 * and closes on Escape (as やめる). Focus returns to the control that opened it.
 *
 *     const confirmed = await this.publishDialog.ask()
 */
export class ConfirmDialog {
	public readonly headingId = `confirm-dialog-${nextId++}`

	/** Catalog key of the title, and its values. */
	@bindable public headingKey = ''
	@bindable public headingParams: Record<string, unknown> | undefined
	/** Catalog key of the confirming button. */
	@bindable public confirmKey = ''
	/** Catalog key of the other button. */
	@bindable public cancelKey = 'common.cancel'
	@bindable public confirmVariant: ConsoleButtonVariant = 'filled'
	/** Disables the confirming button, e.g. while nothing is chosen. */
	@bindable public confirmDisabled = false

	public dialog!: HTMLDialogElement
	public cancelButton!: ConsoleButton
	private resolveAnswer: ((confirmed: boolean) => void) | null = null
	private returnFocusTo: HTMLElement | null = null

	/** Opens the dialog; resolves true when the member confirms. */
	public ask(): Promise<boolean> {
		this.returnFocusTo = focusedElement()
		this.dialog.showModal()
		// The safe choice takes focus first.
		this.cancelButton.focus()
		return new Promise((resolve) => {
			this.resolveAnswer = resolve
		})
	}

	public confirm(): void {
		if (this.confirmDisabled) return
		this.finish(true)
	}

	public cancel(): void {
		this.finish(false)
	}

	/** Escape closes a modal dialog through its `cancel` event. */
	public onCancel(event: Event): void {
		event.preventDefault()
		this.finish(false)
	}

	public detaching(): void {
		this.finish(false)
	}

	private finish(confirmed: boolean): void {
		if (this.dialog?.open) this.dialog.close()
		const resolve = this.resolveAnswer
		this.resolveAnswer = null
		const target = this.returnFocusTo
		this.returnFocusTo = null
		if (!resolve) return
		target?.focus()
		resolve(confirmed)
	}
}
