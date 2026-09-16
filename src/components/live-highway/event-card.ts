import { bindable, INode, resolve } from 'aurelia'
import { bestLogoUrl } from '../../entities/artist'
import {
	JOURNEY_STATUS_CONFIG_MAP,
	type JourneyStatusConfig,
} from '../../entities/ticket-journey'
import { beamTimelineName } from './concert-highway'
import type { LaneType, LiveEvent } from './live-event'

export class EventCard {
	@bindable public event!: LiveEvent
	@bindable public lane: LaneType = 'home'
	public logoError = false

	private readonly element = resolve(INode) as HTMLElement

	public get logoUrl(): string | undefined {
		return bestLogoUrl(this.event.artist)
	}

	/** Canonical label/icon/hue for the concert's journey status, if any. */
	public get journeyConfig(): JourneyStatusConfig | undefined {
		const status = this.event.journeyStatus
		return status ? JOURNEY_STATUS_CONFIG_MAP[status] : undefined
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

	/** When true, tap/click does not fire event-selected (preview mode). */
	@bindable public readonly = false

	public onClick(): void {
		if (this.readonly) return
		this.element.dispatchEvent(
			new CustomEvent('event-selected', {
				detail: { event: this.event },
				bubbles: true,
			}),
		)
	}

	/** Sequential beam index assigned by the highway; null when not matched. */
	@bindable public beamIndex: number | null = null

	/**
	 * Declares this card as the scroll subject driving its laser beam, by naming a
	 * view timeline the beam binds its `animation-timeline` to. The beam is not a
	 * descendant of this card (it lives in a viewport-fixed overlay), so the name
	 * is what carries the link; the highway puts it in scope.
	 *
	 * Inline rather than in the stylesheet because the beam set is data-driven —
	 * there is no static list of names to declare. Empty when this card has no
	 * beam, so unmatched cards declare no timeline at all.
	 */
	public get beamTimelineStyle(): string {
		return this.beamIndex === null
			? ''
			: `view-timeline: ${beamTimelineName(this.beamIndex)} block`
	}

	/**
	 * When true, the venue/location label renders for ALL lanes including HOME.
	 * In the default My Timetable view HOME-lane cards suppress the label (the
	 * lane already implies the user's home area); the All Nearby view sets this
	 * so every card shows where the concert is.
	 */
	@bindable public showVenueAlways = false

	/** Whether to render the location label for this card's lane. */
	public get showLocation(): boolean {
		return this.showVenueAlways || this.lane !== 'home'
	}

	/**
	 * What the location line shows. In the All Nearby view (showVenueAlways) the
	 * venue name is the useful signal — the user already chose the area, so the
	 * prefecture is redundant; fall back to the prefecture label only when the
	 * venue name is absent. My Timetable keeps the prefecture label (locationLabel).
	 */
	public get displayedLocation(): string {
		if (this.showVenueAlways) {
			return this.event.venueName || this.event.locationLabel
		}
		return this.event.locationLabel
	}
}
