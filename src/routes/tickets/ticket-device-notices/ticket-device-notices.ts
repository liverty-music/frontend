import { bindable, INode, resolve } from 'aurelia'
import type { DeviceState } from '../tickets-route'

/**
 * The notices above the tickets about this device: the list is a saved copy
 * shown offline, the device is not ready to show entry codes, or the codes
 * now live on this device. When the codes live on another device it offers
 * to move them here, asking first; the buttons dispatch `use-this-device`,
 * `move-confirm` and `move-cancel`, and the page does the move.
 */
export class TicketDeviceNotices {
	/** True once the ticket list has loaded; most notices wait for it. */
	@bindable public loaded = false
	@bindable public offline = false
	/** When the saved list was saved, as the fan reads it. */
	@bindable public savedAt = ''
	@bindable public device: DeviceState = 'checking'
	/** True when the last check or move took the codes over from another device. */
	@bindable public movedHere = false
	@bindable public canOfferMove = false
	/** True while the fan is asked to confirm the move. */
	@bindable public confirming = false
	@bindable public moving = false
	@bindable public moveFailed = false

	private readonly host = resolve(INode) as HTMLElement

	public send(name: 'use-this-device' | 'move-confirm' | 'move-cancel'): void {
		this.host.dispatchEvent(new CustomEvent(name, { bubbles: true }))
	}
}
