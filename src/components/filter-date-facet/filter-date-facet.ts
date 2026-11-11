import { bindable } from 'aurelia'

/**
 * The filter sheet's date facet: a collapsed "過去のコンサートも表示" toggle
 * that expands a single "from" date field. Unlike the artist and journey
 * facets it widens the timetable into the past (the filter sheet re-fetches on
 * confirm), so it starts collapsed and the timetable stays today-onward.
 */
export class FilterDateFacet {
	/** The pending `from` date as a `YYYY-MM-DD` string (bound to the date input). */
	@bindable({ mode: 'twoWay' }) public from = ''
	/** Whether the date field is shown. */
	@bindable({ mode: 'twoWay' }) public expanded = false

	public toggle(): void {
		this.expanded = !this.expanded
	}
}
