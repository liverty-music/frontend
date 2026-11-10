import { bindable } from 'aurelia'

/** The name of the stamp's pressing animation (admission-stamp.css). */
export const STAMP_ANIMATION = 'admission-stamp-press'

/**
 * The admission stamp on a virtual ticket: 入場済 and the admit time, as text.
 * `pressing` plays the pressing animation once; otherwise the stamp is at
 * rest. The face decides which (see VirtualTicket).
 */
export class AdmissionStamp {
	/** The admit time as shown, e.g. "11/20 18:32". */
	@bindable public time = ''
	/** The admit time as an ISO 8601 instant, for `<time datetime>`. */
	@bindable public datetime = ''
	@bindable public pressing = false

	/** `press` while the stamp is being pressed, `rest` otherwise. */
	public get stamp(): 'press' | 'rest' {
		return this.pressing ? 'press' : 'rest'
	}
}
