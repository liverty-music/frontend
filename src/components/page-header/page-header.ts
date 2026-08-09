import { bindable } from 'aurelia'

export class PageHeader {
	@bindable public titleKey = ''
	/**
	 * When true, the H1 gets a stable `view-transition-name` (via the `morph-title`
	 * class) so a caller can morph the title across a same-document View Transition
	 * — the dashboard uses this to animate the My Timetable ↔ All Nearby title swap.
	 * Default false = no transition name (unchanged for every other page).
	 */
	@bindable public morphTitle = false
}
