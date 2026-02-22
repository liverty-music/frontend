import { bindable, INode, resolve } from 'aurelia'
import { artistColor } from './color-generator'
import type { LaneType, LiveEvent } from './live-event'

export class EventCard {
	@bindable public event!: LiveEvent
	@bindable public lane: LaneType = 'main'

	private readonly element = resolve(INode) as HTMLElement

	public get backgroundColor(): string {
		return artistColor(this.event.artistName)
	}

	public get isMutated(): boolean {
		return this.event.isMustGo && this.lane !== 'main'
	}

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
