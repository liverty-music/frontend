import { bindable, INode, resolve } from 'aurelia'
import type { SnackAction } from '../../../shared/ui/snack-bar/snack'
import type { OutOfRangeNotice as Notice } from './event-detail-sheet'

/**
 * What the fan's hype level pushes for this concert, under the venue in the
 * event detail sheet, with the button that widens the level; after the fan
 * widened it, the saved line and the push offer. Placed on the sheet's
 * section with `as-element`. The widen press is reported to the sheet as a
 * `widen` event.
 */
export class OutOfRangeNotice {
	@bindable public notice!: Notice
	@bindable public updating = false
	@bindable public pushAction: SnackAction | null = null

	private readonly element = resolve(INode) as HTMLElement

	public widen(): void {
		this.element.dispatchEvent(new CustomEvent('widen'))
	}
}
