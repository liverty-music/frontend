import { bindable } from 'aurelia'

export class Toast {
	@bindable public open = false

	private popoverEl!: HTMLDialogElement

	public openChanged(isOpen: boolean): void {
		if (!this.popoverEl) return

		if (isOpen) {
			this.popoverEl.showPopover()
		} else {
			try {
				this.popoverEl.hidePopover()
			} catch {
				// Already hidden
			}
			this.popoverEl.dispatchEvent(
				new CustomEvent('toast-closed', { bubbles: true }),
			)
		}
	}

	public attached(): void {
		if (this.open) {
			this.openChanged(true)
		}
	}

	public detaching(): void {
		try {
			this.popoverEl.hidePopover()
		} catch {
			// Already hidden or not in DOM
		}
	}
}
