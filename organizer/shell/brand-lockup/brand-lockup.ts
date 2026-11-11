import { bindable } from 'aurelia'

/**
 * The brand lockup at the start of the top app bar: Liverty Music over
 * Organizer Console on a compact window, on one line from 600 px (design
 * D20), linking to the console's home. Below a destination on a compact
 * window (`deep`) the back arrow and the page title take its place.
 */
export class BrandLockup {
	@bindable public href = ''
	@bindable public deep = false
}
