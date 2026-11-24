import { bindable } from 'aurelia'

/**
 * The artist's image across the top of the event detail sheet, fading into
 * the sheet's surface. Placed on the sheet's hero `<div>` with `as-element`.
 */
export class ConcertSheetHero {
	@bindable public src = ''

	/** The image has loaded, so it fades in over the hero's box. */
	public loaded = false

	protected srcChanged(): void {
		this.loaded = false
	}
}
