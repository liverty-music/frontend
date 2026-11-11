import { bindable } from 'aurelia'

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
}
