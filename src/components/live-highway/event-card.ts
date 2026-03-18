import { bindable, INode, resolve } from 'aurelia'
import { bestLogoUrl } from '../../entities/artist'
import type { LaneType, LiveEvent } from './live-event'

export class EventCard {
	@bindable public event!: LiveEvent
	@bindable public lane: LaneType = 'home'
	public logoError = false

	private readonly element = resolve(INode) as HTMLElement

	public get logoUrl(): string | undefined {
		return bestLogoUrl(this.event.artist)
	}

	public eventChanged(): void {
		this.logoError = false
	}

	public onLogoError(): void {
		this.logoError = true
	}

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

	/** Sequential beam index assigned by dashboard for JS beam tracking. */
	@bindable public beamIndex: number | null = null
}
