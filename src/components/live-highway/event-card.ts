import { bindable, INode, resolve } from 'aurelia'
import { bestLogoUrl } from '../../entities/artist'
import {
	JOURNEY_STATUS_CONFIG_MAP,
	type JourneyStatusConfig,
} from '../../entities/ticket-journey'
import { beamTimelineName } from './beam-name'
import type { LaneType, LiveEvent } from './live-event'

export class EventCard {
	@bindable public event!: LiveEvent
	@bindable public lane: LaneType = 'home'
	public logoError = false

	private readonly element = resolve(INode) as HTMLElement

	public get logoUrl(): string | undefined {
		return bestLogoUrl(this.event.artist)
	}

	/**
	 * Canonical label/icon/hue for the concert's journey status, if any. A
	 * first-party concert never shows a journey badge: it shows what the fan
	 * bought instead (see {@link isPurchased}).
	 */
	public get journeyConfig(): JourneyStatusConfig | undefined {
		if (this.event.isFirstParty) return undefined
		const status = this.event.journeyStatus
		return status ? JOURNEY_STATUS_CONFIG_MAP[status] : undefined
	}

	/** True when the fan holds an Issued ticket for this first-party concert. */
	public get isPurchased(): boolean {
		return this.event.isFirstParty && (this.event.purchasedTicketCount ?? 0) > 0
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

	/**
	 * The view-timeline name this card's beam follows. Bound one-time: it is
	 * derived from the concert id alone, and a card view never changes concert
	 * (the lane repeat is keyed by id). The card itself never declares the
	 * timeline — the highway's stylesheet does, and only while beams are on.
	 */
	public get beamName(): string {
		return beamTimelineName(this.event.id)
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
