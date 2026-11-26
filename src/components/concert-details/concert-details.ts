import { bindable } from 'aurelia'

/**
 * When and where an Event takes place, as its page shows it: the date with
 * the open and start times, then the venue, its prefecture and a link to the
 * venue on Google Maps. Every value comes formatted from the page.
 */
export class ConcertDetails {
	/** Calendar date as `YYYY-MM-DD`, for the `<time>` element. */
	@bindable public dateKey = ''
	@bindable public dateLabel = ''
	@bindable public openTimeLabel = ''
	@bindable public startTimeLabel = ''
	/** The Venue zone's name with the viewer's times, or '' when none is shown. */
	@bindable public zoneLabel = ''
	@bindable public venueName = ''
	@bindable public prefecture = ''
	@bindable public mapsUrl = ''
}
