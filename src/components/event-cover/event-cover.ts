import { bindable } from 'aurelia'

/**
 * The cover of an Event page: the event's image at 16:9, or the brand
 * placeholder when it has none. Decorative; the title names the event.
 */
export class EventCover {
	/** The cover image's URL; empty shows the placeholder. */
	@bindable public url = ''
}
