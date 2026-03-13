import { INode, bindable, resolve } from 'aurelia'

export class HypeNotificationDialog {
	@bindable public active = false

	private readonly element = resolve(INode) as HTMLElement
	private dialogRef!: HTMLDialogElement

	public activeChanged(newVal: boolean): void {
		if (newVal) {
			this.dialogRef?.showModal()
		} else {
			this.dialogRef?.close()
		}
	}

	public onSignup(): void {
		this.element.dispatchEvent(
			new CustomEvent('signup-requested', { bubbles: true }),
		)
	}

	public onDismiss(): void {
		this.active = false
		this.element.dispatchEvent(
			new CustomEvent('dialog-dismissed', { bubbles: true }),
		)
	}
}
