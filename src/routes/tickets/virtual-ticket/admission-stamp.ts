import { bindable } from 'aurelia'

/** The name of the stamp's pressing animation (admission-stamp.css). */
export const STAMP_ANIMATION = 'admission-stamp-press'

let nextId = 0

/**
 * The admission stamp on a virtual ticket: a round seal of red ink with 入場済
 * as text, ringed by the event's date. `pressing` plays
 * the pressing animation once; otherwise the stamp is at rest. The ticket
 * decides which (see VirtualTicket).
 */
export class AdmissionStamp {
	/** The event's date as printed around the seal, e.g. "2026.12.20". */
	@bindable public date = ''
	@bindable public pressing = false

	private readonly id = ++nextId
	/** Ids of the seal's SVG definitions, unique per stamp on the page. */
	public readonly inkId = `admission-stamp-ink-${this.id}`
	public readonly arcId = `admission-stamp-arc-${this.id}`

	/** `press` while the stamp is being pressed, `rest` otherwise. */
	public get stamp(): 'press' | 'rest' {
		return this.pressing ? 'press' : 'rest'
	}
}
