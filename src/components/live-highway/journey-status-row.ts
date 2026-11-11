import { bindable, INode, resolve } from 'aurelia'
import type { JourneyStatusConfig } from '../../entities/ticket-journey'
import type { JourneyStatus } from './live-event'

/**
 * The ticket-journey statuses under the detail sheet's notification button,
 * one toggle each; the current one is pressed. Placed on the sheet's
 * `.journey-row` with `as-element`. A press is reported to the sheet as a
 * `status-pressed` event carrying the status.
 */
export class JourneyStatusRow {
	@bindable public statuses: readonly JourneyStatusConfig[] = []
	@bindable public status: JourneyStatus | undefined
	@bindable public disabled = false

	private readonly element = resolve(INode) as HTMLElement

	public press(status: JourneyStatus): void {
		this.element.dispatchEvent(
			new CustomEvent<JourneyStatus>('status-pressed', { detail: status }),
		)
	}
}
