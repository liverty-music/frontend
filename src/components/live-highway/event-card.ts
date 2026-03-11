import { bindable, INode, resolve } from 'aurelia'
import type { LaneType, LiveEvent } from './live-event'

export class EventCard {
	@bindable public event!: LiveEvent
	@bindable public lane: LaneType = 'home'

	private readonly element = resolve(INode) as HTMLElement

	public get formattedDate(): string {
		return this.event.date.toLocaleDateString('ja-JP', {
			month: 'short',
			day: 'numeric',
		})
	}

	public onClick(): void {
		this.element.dispatchEvent(
			new CustomEvent('event-selected', {
				detail: { event: this.event },
				bubbles: true,
			}),
		)
	}
}
