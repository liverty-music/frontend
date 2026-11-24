import { bindable } from 'aurelia'

/**
 * The cover of a concert page: the event's image at 16:9, or the brand
 * placeholder when it has none. Decorative; the title names the event.
 */
export class ConcertCover {
	/** The cover image's URL; empty shows the placeholder. */
	@bindable public url = ''

	/** The image has loaded, so it fades in over the cover's box. */
	public loaded = false

	protected urlChanged(): void {
		this.loaded = false
	}
}
