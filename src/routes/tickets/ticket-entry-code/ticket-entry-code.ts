import { bindable, INode, resolve } from 'aurelia'

/**
 * The entry QR code sheet's body: one code for every not-yet-entered ticket
 * of an event (up to 10), how many people it admits, and which tickets it
 * presents. None can be left out. The close button dispatches `code-close`.
 */
export class TicketEntryCode {
	/** The event's title, or empty when it is unknown. */
	@bindable public eventTitle = ''

	/** The number of each ticket the code presents; empty when all entered. */
	@bindable public numbers: readonly number[] = []

	/** The QR image, or empty while the code is being made. */
	@bindable public image = ''

	private readonly host = resolve(INode) as HTMLElement

	public close(): void {
		this.host.dispatchEvent(new CustomEvent('code-close', { bubbles: true }))
	}
}
