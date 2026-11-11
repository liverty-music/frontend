import { bindable } from 'aurelia'

/**
 * The timetable's first row: one head per stage, each over its lane. Placed
 * on the highway's `<header>` with `as-element`, so it subgrids off the
 * highway's columns with no box of its own.
 */
export class StageHeader {
	/** Omit the AWAY head (the All Nearby view shows two lanes). */
	@bindable public hideAway = false
}
