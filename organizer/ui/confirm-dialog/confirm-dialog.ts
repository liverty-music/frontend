import { I18N } from '@aurelia/i18n'
import { bindable, resolve } from 'aurelia'
import type { ConsoleButtonVariant } from '../console-button/console-button'

/**
 * M3 basic dialog that asks before an action that cannot be undone or that
 * reaches people outside the console. The title names the action and its
 * object, the body states the effect, the confirming button names the action
 * and the other button is やめる.
 *
 * Built on the native `<dialog>` with `showModal()`: the platform traps focus
 * and closes on Escape (as やめる). Focus returns to the control that opened it.
 *
 *     const confirmed = await this.publishDialog.ask()
 */
let nextId = 0

export class ConfirmDialog {
	public readonly headingId = `confirm-dialog-${nextId++}`

	@bindable public heading = ''
	@bindable public confirmLabel = ''
	@bindable public cancelLabel = ''
	@bindable public confirmVariant: ConsoleButtonVariant = 'filled'
	/** Disables the confirming button, e.g. while nothing is chosen. */
	@bindable public confirmDisabled = false

	private readonly i18n = resolve(I18N)

	public dialog!: HTMLDialogElement
	public cancelButton!: HTMLElement
	private resolveAnswer: ((confirmed: boolean) => void) | null = null
	private returnFocusTo: HTMLElement | null = null

	public get cancelText(): string {
		return this.cancelLabel || this.i18n.tr('common.cancel')
	}

	/** Opens the dialog; resolves true when the operator confirms. */
	public ask(): Promise<boolean> {
		this.returnFocusTo =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null
		this.dialog.showModal()
		// The safe choice takes focus first.
		this.cancelButton.querySelector('button')?.focus()
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
