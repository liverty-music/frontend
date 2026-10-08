import { bindable } from 'aurelia'

/** One date of a Series, as a tab of the Event page. */
export interface EventDateTab {
	/** Event id; the tab links to `/events/<id>`. */
	readonly id: string
	/** Date with weekday in the display language, e.g. "11/20(金)". */
	readonly label: string
	/** True for the displayed Event's tab. */
	readonly selected: boolean
}

/**
 * The date tabs of an Event page whose Series has 2–4 Events. Each tab is a
 * link to that Event's own page, so every date is shareable and the back
 * control returns to the previous date. Purely presentational: the route
 * builds the tabs in date order.
 */
export class EventDateTabs {
	@bindable public tabs: readonly EventDateTab[] = []
	/** Accessible name of the tab list. */
	@bindable public label = ''
}
