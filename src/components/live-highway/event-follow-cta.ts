import { bindable, INode, resolve } from 'aurelia'

/**
 * The event detail sheet's Follow button in All Nearby: it turns a
 * discovered concert into a followed artist, then shows a static
 * "Following". Placed on the sheet's section with `as-element`; the press is
 * reported to the sheet as a `follow` event.
 */
export class EventFollowCta {
	@bindable public followed = false
	@bindable public updating = false

	private readonly element = resolve(INode) as HTMLElement

	public follow(): void {
		this.element.dispatchEvent(new CustomEvent('follow'))
	}
}
