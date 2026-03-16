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

	public handleKeydown(event: KeyboardEvent): void {
		if (event.key === ' ') {
			this.onClick()
			event.preventDefault()
		}
	}

	public onClick(): void {
		this.element.dispatchEvent(
			new CustomEvent('event-selected', {
				detail: { event: this.event },
				bubbles: true,
			}),
		)
	}

	/** Sequential beam index assigned by dashboard for CSS anchor positioning. */
	@bindable public beamIndex: number | null = null

	/**
	 * CSS anchor-name value for this card (e.g. "--beam-0").
	 * Returns empty string when not a beam target.
	 */
	public get anchorStyle(): string {
		if (this.beamIndex === null || !this.event?.matched) return ''
		return `anchor-name: --beam-${this.beamIndex}`
	}
}
