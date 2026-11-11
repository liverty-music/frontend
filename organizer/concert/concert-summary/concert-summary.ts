import { bindable } from 'aurelia'

/**
 * The concert page's supporting pane (M3 supporting pane layout): the cover,
 * with the processing note while a picked cover is processed, then the
 * concert's type, visibility and performers. Beside the dates from 840 px,
 * below them on narrower windows.
 */
export class ConcertSummary {
	@bindable public coverUrl = ''
	@bindable public coverNote: '' | 'processing' | 'slow' = ''
	@bindable public typeKey = ''
	@bindable public visibilityKey = ''
	@bindable public performers: string[] = []
}
