import { bindable, INode, resolve } from 'aurelia'
import { bestLogoUrl } from '../../entities/artist'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import type { LaneType, LiveEvent } from './live-event'

export class EventCard {
	@bindable public event!: LiveEvent
	@bindable public lane: LaneType = 'home'
	/**
	 * 0-based position of this card within its lane (`repeat.for` `$index`
	 * from concert-highway.html). Powers the `position` property on the
	 * `concert.recommendation.clicked` analytics event so the
	 * recommendation engine can correlate click-through against the
	 * backend's `concert.recommendation.served` impression metric. Left
	 * as `null` for callers that do not yet bind it; the click handler
	 * skips the analytics emission in that case rather than capturing a
	 * misleading `0`.
	 */
	@bindable public position: number | null = null
	public logoError = false

	private readonly element = resolve(INode) as HTMLElement
	private readonly analytics = resolve(IAnalyticsService)

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

	/** When true, tap/click does not fire event-selected (preview mode). */
	@bindable public readonly = false

	public onClick(): void {
		if (this.readonly) return
		// Fire concert.recommendation.clicked BEFORE the custom event
		// dispatch so the analytics signal is captured even if the
		// downstream bottom-sheet open path throws. `position === null`
		// indicates a caller that has not opted into recommendation
		// tracking (e.g. the read-only preview card in onboarding) —
		// emitting position: 0 in that branch would pollute the
		// recommendation-engine click-through metric, so the event is
		// skipped entirely.
		if (this.position !== null) {
			this.analytics.capture(Events.ConcertRecommendationClicked, {
				concert_id: this.event.id,
				artist_id: this.event.artistId,
				position: this.position,
			})
		}
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
