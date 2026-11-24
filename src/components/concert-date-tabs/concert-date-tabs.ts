import { bindable } from 'aurelia'

/** One date of a Series, as a tab of the concert page. */
export interface ConcertDateTab {
	/** Event id; the tab links to `/concerts/<id>`. */
	readonly id: string
	/** Date with weekday in the display language, e.g. "11/20(金)". */
	readonly label: string
	/** True for the displayed Event's tab. */
	readonly selected: boolean
	/** True when this date is cancelled; the tab is marked with `cancelledLabel`. */
	readonly cancelled: boolean
}

/**
 * The date tabs of a concert page whose Series has 2–4 Events. Each tab is a
 * link to that Event's own page, so every date is shareable and the back
 * control returns to the previous date. Purely presentational: the route
 * builds the tabs in date order.
 */
export class ConcertDateTabs {
	@bindable public tabs: readonly ConcertDateTab[] = []
	/** Accessible name of the tab list. */
	@bindable public label = ''
	/** The mark of a cancelled date in the display language, e.g. "中止". */
	@bindable public cancelledLabel = ''

	/**
	 * A tab is a link, which a key activates with Enter only; Material 3 tabs
	 * also take Space. Space on a focused tab follows its link.
	 */
	public activateWithSpace(event: KeyboardEvent): boolean {
		const tab = (event.target as Element | null)?.closest('a.date-tab')
		if (tab && event.key === ' ' && !event.repeat) {
			event.preventDefault()
			;(tab as HTMLElement).click()
			return false
		}
		return true
	}
}
