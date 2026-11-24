import { bindable, INode, resolve } from 'aurelia'

/**
 * The sheet the fan sees: the Material 3 bottom-sheet container with its drag
 * handle, an optional heading with a sheet-wide action beside it, and the
 * content. `bottom-sheet` around it shows, scrolls and dismisses it, and
 * observes and focuses `body`.
 */
export class SheetSurface {
	/** Plain-text heading below the handle; it also names the sheet. */
	@bindable public heading = ''
	/** The heading's id, which the sheet's dialog points `aria-labelledby` at. */
	@bindable public headingId = ''
	/** The container, handed to `bottom-sheet`. */
	@bindable public body?: HTMLElement
	/** Whether the fan may close the sheet: the handle is then a button. */
	@bindable public dismissable = true

	private readonly host = resolve(INode) as HTMLElement

	/** The handle was activated: ask `bottom-sheet` around the surface to close. */
	public requestDismiss(): void {
		this.host.dispatchEvent(
			new CustomEvent('sheet-dismiss-request', { bubbles: true }),
		)
	}
}
