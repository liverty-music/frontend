import { bindable } from 'aurelia'

/**
 * The artist's image across the top of the event detail sheet, fading into
 * the sheet's surface. Placed on the sheet's hero `<div>` with `as-element`.
 */
export class EventSheetHero {
	@bindable public src = ''
}
