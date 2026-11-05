import { bindable } from 'aurelia'

export type ConfirmTone = 'default' | 'danger'

let nextId = 0

/**
 * A modal confirmation asked before an action the fan may regret (sign out,
 * changing the ticket name, deleting the account). A native `<dialog>` opened
 * with `showModal()`: the platform makes the rest of the page inert, traps
 * focus and turns Escape into a close. Cancel takes focus first, the safe
 * choice (WAI-ARIA APG alert dialog pattern).
 *
 * The caller awaits {@link ask}: `true` when the fan confirms, `false` on
 * Cancel, Escape or a tap on the backdrop.
 */
export class ConfirmDialog {
	@bindable public heading = ''
	@bindable public body = ''
	@bindable public confirmLabel = ''
	/** `danger` colours the confirm control for an action that cannot be undone. */
	@bindable public tone: ConfirmTone = 'default'
	/** `data-testid` of the dialog; Cancel gets `<testId>-cancel`. */
	@bindable public testId = 'confirm-dialog'
	/** `data-testid` of the confirm control; defaults to `<testId>-confirm`. */
	@bindable public confirmTestId = ''

	public readonly headingId = `confirm-dialog-heading-${++nextId}`
	public readonly bodyId = `confirm-dialog-body-${nextId}`

	/** Bound via `ref`. */
	public dialog?: HTMLDialogElement
	public cancelButton?: HTMLButtonElement

	private settle: ((confirmed: boolean) => void) | null = null

	public get cancelTestId(): string {
		return `${this.testId}-cancel`
	}

	public get confirmButtonTestId(): string {
		return this.confirmTestId || `${this.testId}-confirm`
	}

	/** The confirm control's button variant: filled, or danger. */
	public get confirmVariant(): 'danger' | null {
		return this.tone === 'danger' ? 'danger' : null
	}

	/** Open the dialog and resolve with the fan's answer. */
	public ask(): Promise<boolean> {
		// A second ask while one is open answers the first with "no".
		this.finish(false)
		return new Promise<boolean>((resolve) => {
			this.settle = resolve
			const dialog = this.dialog
			if (!dialog) return
			try {
				dialog.showModal()
			} catch {
				// No showModal (jsdom): mark it open so the answer can still come.
				dialog.setAttribute('open', '')
			}
			this.cancelButton?.focus()
		})
	}

	public confirm(): void {
		this.finish(true)
	}

	public cancel(): void {
		this.finish(false)
	}

	/** Escape closes a modal dialog natively; any close is a "no". */
	public onClose(): void {
		this.finish(false)
	}

	/** A click whose target is the dialog itself landed on the backdrop. */
	public onClick(event: MouseEvent): void {
		if (event.target === this.dialog) this.finish(false)
	}

	/**
	 * Keep Escape and Tab inside the dialog. A bottom sheet under it listens on
	 * the document for both (to dismiss itself and to trap focus); the dialog
	 * handles them natively, so they must not reach the sheet.
	 */
	public onKeydown(event: KeyboardEvent): boolean {
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.stopPropagation()
		}
		// Let the platform act on the key (close request, focus move).
		return true
	}

	public detaching(): void {
		this.finish(false)
	}

	private finish(confirmed: boolean): void {
		const settle = this.settle
		this.settle = null
		const dialog = this.dialog
		if (dialog?.hasAttribute('open')) {
			try {
				dialog.close()
			} catch {
				dialog.removeAttribute('open')
			}
		}
		settle?.(confirmed)
	}
}
