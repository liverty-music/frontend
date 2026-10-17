import { bindable } from 'aurelia'
import type { ConfirmDialog } from '../confirm-dialog/confirm-dialog'

/**
 * Keeps an editor's unsaved changes from being lost by leaving. While `dirty`:
 * leaving through navigation asks 破棄する / 編集を続ける (the editor's
 * `canUnload` returns {@link confirmLeave}), and closing or reloading the tab
 * triggers the browser's own leave warning.
 *
 *     public canUnload(): Promise<boolean> { return this.guard.confirmLeave() }
 */
export class UnsavedChanges {
	@bindable public dirty = false

	public dialog!: ConfirmDialog

	private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
		if (!this.dirty) return
		event.preventDefault()
		// Older engines need a value to show the prompt.
		event.returnValue = ''
	}

	public attached(): void {
		window.addEventListener('beforeunload', this.onBeforeUnload)
	}

	public detaching(): void {
		window.removeEventListener('beforeunload', this.onBeforeUnload)
	}

	/** True when the editor may be left: nothing unsaved, or the member discards it. */
	public async confirmLeave(): Promise<boolean> {
		if (!this.dirty) return true
		return this.dialog.ask()
	}
}
