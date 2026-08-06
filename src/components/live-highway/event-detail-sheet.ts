import { bindable, ILogger, resolve } from 'aurelia'
import { IHistory } from '../../adapter/browser/history'
import { bestBackgroundUrl } from '../../entities/artist'
import {
	JOURNEY_NAV_ORDER,
	JOURNEY_STATUS_CONFIG_MAP,
	type JourneyNodeState,
	type JourneyOutcome,
	journeyNodeState,
	journeyOutcome,
} from '../../entities/ticket-journey'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import type { EventSource } from '../../services/analytics-events'
import { IAuthService } from '../../services/auth-service'
import { IFollowStore } from '../../services/follow-store'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import type { JourneyStatus, LiveEvent } from './live-event'

export class EventDetailSheet {
	@bindable public event: LiveEvent | null = null

	/**
	 * True when the sheet was opened from the All Nearby discovery view. Only in
	 * that context does the follow CTA surface — the My Timetable context already
	 * implies a followed artist, so the CTA stays hidden and the sheet is
	 * unchanged there.
	 */
	@bindable public isAllNearby = false

	/**
	 * Invoked when an unauthenticated visitor taps the follow CTA. The host route
	 * owns the sign-up prompt banner; a callback (not a DOM event) keeps this
	 * component free of element injection and testable via plain DI construction.
	 */
	@bindable public onSignupRequested?: () => void

	public isOpen = false
	public journeyUpdating = false
	public followUpdating = false

	/** Canonical label/icon/hue per status, sourced once for every node. */
	public readonly journeyConfig = JOURNEY_STATUS_CONFIG_MAP

	private readonly logger = resolve(ILogger).scopeTo('EventDetailSheet')
	private readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly authService = resolve(IAuthService)
	private readonly followStore = resolve(IFollowStore)
	private readonly history = resolve(IHistory)
	private readonly analytics = resolve(IAnalyticsService)

	// Arrow function to allow `removeEventListener` with the same reference
	private readonly onPopstate = (): void => {
		if (this.isOpen) {
			this.isOpen = false
			window.removeEventListener('popstate', this.onPopstate)
		}
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	/** Whether the current event's artist is already in the follow set. */
	public get isFollowed(): boolean {
		const id = this.event?.artistId
		return id ? this.followStore.followedIds.has(id) : false
	}

	/**
	 * Show the follow CTA only in the All Nearby context, only for an event whose
	 * artist is resolved (a resolvable performer identity) and not already
	 * followed. My Timetable events implicitly belong to a followed artist, so the
	 * CTA never shows there.
	 */
	public get showFollowCta(): boolean {
		return this.isAllNearby && !!this.event?.artist && !this.isFollowed
	}

	/**
	 * Follow the event's artist from the All Nearby CTA. Unauthenticated visitors
	 * are routed to the sign-up prompt instead of a guest follow — the discovery
	 * follow is the conversion moment. A missing/unresolved artist is guarded
	 * (logged, no-op) so a performer-less card can never crash the sheet.
	 */
	public async follow(): Promise<void> {
		if (this.followUpdating || this.isFollowed) return

		if (!this.isAuthenticated) {
			// Guest: surface the sign-up prompt rather than a guest follow. The
			// banner is owned by the host route via the onSignupRequested callback.
			this.onSignupRequested?.()
			return
		}

		const artist = this.event?.artist
		if (!artist) {
			// Unresolved performer: the button is already hidden by showFollowCta,
			// but guard the write path so a stale invocation cannot throw.
			this.logger.warn(
				'Follow requested for an event with no resolved artist',
				{
					eventId: this.event?.id,
				},
			)
			return
		}

		this.followUpdating = true
		try {
			await this.followStore.follow(artist)
			this.logger.info('Artist followed from All Nearby', {
				artistId: artist.id,
			})
		} catch (err) {
			this.logger.warn('Failed to follow artist from All Nearby', {
				error: err,
			})
		} finally {
			this.followUpdating = false
		}
	}

	/**
	 * The event's journey status, read from the single source of truth
	 * (`TicketJourneyStore`) rather than a local copy on `event`. Reading the
	 * observable map here means a write from any surface reflects in this sheet
	 * without a re-fetch, and the sheet and Dashboard can never diverge.
	 */
	public get status(): JourneyStatus | undefined {
		return this.journeyStore.statusFor(this.event?.id)
	}

	public get backgroundUrl(): string | undefined {
		return bestBackgroundUrl(this.event?.artist)
	}

	public get hasMerchUrl(): boolean {
		return Boolean(this.event?.merchUrl)
	}

	public get googleMapsUrl(): string {
		if (!this.event) return '#'
		const area = this.event.locationLabel
		const query = area
			? `${this.event.venueName} ${area}`
			: this.event.venueName
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
	}

	public get calendarUrl(): string {
		if (!this.event) return '#'
		const e = this.event
		const dateStr = [
			e.date.getFullYear(),
			String(e.date.getMonth() + 1).padStart(2, '0'),
			String(e.date.getDate()).padStart(2, '0'),
		].join('')
		const startTime = e.startTime || '19:00'
		const startStr = `${startTime.replace(':', '')}00`
		const [hours, mins] = startTime.split(':').map(Number)
		const endDate = new Date(e.date)
		endDate.setHours(hours + 2, mins)
		const endDateStr = [
			endDate.getFullYear(),
			String(endDate.getMonth() + 1).padStart(2, '0'),
			String(endDate.getDate()).padStart(2, '0'),
		].join('')
		const endStr = `${String(endDate.getHours()).padStart(2, '0')}${String(endDate.getMinutes()).padStart(2, '0')}00`
		return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dateStr}T${startStr}/${endDateStr}T${endStr}&location=${encodeURIComponent(e.venueName)}`
	}

	public open(
		event: LiveEvent,
		source: EventSource = 'page',
		isAllNearby = false,
	): void {
		this.event = event
		this.isAllNearby = isAllNearby
		this.isOpen = true

		// Push URL without triggering Aurelia Router navigation — the sheet is an
		// overlay on the dashboard, not a separate route component. A full navigation
		// would destroy and recreate the dashboard component (and this sheet).
		this.history.pushState({ concertId: event.id }, '', `/concerts/${event.id}`)

		// Listen for browser back navigation (popstate) to close the sheet.
		window.addEventListener('popstate', this.onPopstate)

		// Fire after the sheet state flips — listeners observe consistent state.
		this.analytics.capture(Events.ConcertDetailViewed, {
			event_id: event.id,
			artist_id: event.artistId,
			source,
		})
	}

	/** Programmatic close — replaces current history entry with dashboard URL */
	public close(): void {
		if (!this.isOpen) return
		this.isOpen = false
		window.removeEventListener('popstate', this.onPopstate)
		this.history.replaceState(null, '', '/dashboard')
	}

	/** Handles the sheet-closed event dispatched by <bottom-sheet> on light-dismiss or swipe */
	public onSheetClosed(): void {
		this.close()
	}

	/**
	 * Per-status display state derived from the single stored `journeyStatus`,
	 * using the fixed journey DAG: tracking → applied → { lost | unpaid → paid }.
	 * `current` is the selected node, `completed` the nodes already passed on its
	 * path, `future` the not-yet-reached nodes. Mutual exclusivity of the win/lose
	 * routes is handled at the route-container level (see successDimmed/failureDimmed).
	 */
	public get nodeStates(): Record<JourneyStatus, JourneyNodeState> {
		const current = this.status
		return {
			tracking: journeyNodeState('tracking', current),
			applied: journeyNodeState('applied', current),
			lost: journeyNodeState('lost', current),
			unpaid: journeyNodeState('unpaid', current),
			paid: journeyNodeState('paid', current),
		}
	}

	/**
	 * Roving tabindex for the journey radiogroup: exactly one node is a tab stop
	 * (the selected status, or the first node when nothing is selected yet).
	 */
	public journeyTabindex(status: JourneyStatus): number {
		const active = this.status ?? JOURNEY_NAV_ORDER[0]
		return status === active ? 0 : -1
	}

	/**
	 * ARIA radio keyboard pattern: arrow keys (and Home/End) move focus along the
	 * journey graph and select the focused node. Selection follows focus, matching
	 * the WAI-ARIA radiogroup contract that screen readers announce.
	 */
	public async onJourneyKeydown(event: KeyboardEvent): Promise<void> {
		const order = JOURNEY_NAV_ORDER
		const current = this.status ?? order[0]
		let index = order.indexOf(current)
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				index = Math.min(index + 1, order.length - 1)
				break
			case 'ArrowLeft':
			case 'ArrowUp':
				index = Math.max(index - 1, 0)
				break
			case 'Home':
				index = 0
				break
			case 'End':
				index = order.length - 1
				break
			default:
				return
		}
		event.preventDefault()
		// Capture the group element before awaiting — `currentTarget` is nulled
		// once the event finishes dispatching.
		const group = event.currentTarget as HTMLElement
		const next = order[index]
		// No-op if clamped to the same position as the current effective status.
		if (next === current) return
		// Block navigation between mutually exclusive outcome branches: a user on
		// the win route must not accidentally overwrite 'paid' with 'lost' (or vice
		// versa) via a single arrow keypress.
		const outcome = this.outcome
		if (outcome === 'won' && next === 'lost') return
		if (outcome === 'lost' && (next === 'unpaid' || next === 'paid')) return
		await this.setJourneyStatus(next)
		// Move focus only after the status update settles, so the target button
		// (briefly disabled while updating) is focusable again.
		group.querySelector<HTMLElement>(`[data-journey-status="${next}"]`)?.focus()
	}

	/**
	 * Single classification of the win/lose fork; the gating and per-route
	 * dimming below all derive from it so the rule lives in one place.
	 */
	public get outcome(): JourneyOutcome {
		return journeyOutcome(this.status)
	}

	/** The outcome phase is shown dimmed ("結果待ち") until a result is reached. */
	public get outcomePending(): boolean {
		return this.outcome === 'pending'
	}

	/** Win route is dimmed once the mutually-exclusive loss is recorded. */
	public get successDimmed(): boolean {
		return this.outcome === 'lost'
	}

	/** Loss route is dimmed once the mutually-exclusive win is recorded. */
	public get failureDimmed(): boolean {
		return this.outcome === 'won'
	}

	public get openTimeOrFallback(): string {
		return this.event?.openTime ?? '—'
	}

	public async setJourneyStatus(status: JourneyStatus): Promise<void> {
		if (!this.event || this.journeyUpdating) return
		// Capture the event so a sheet reopen on a different concert mid-request
		// cannot redirect the write to the wrong event after the await.
		const event = this.event
		this.journeyUpdating = true
		try {
			// Write-through the store (the single source of truth); it updates its
			// observable map on success, which re-renders this sheet and the
			// Dashboard without a re-fetch. No local `event.journeyStatus` copy.
			await this.journeyStore.setStatus(event.id, status)
		} catch (err) {
			this.logger.warn('Failed to set journey status', { error: err })
		} finally {
			this.journeyUpdating = false
		}
	}

	public async removeJourney(): Promise<void> {
		if (!this.event || this.journeyUpdating) return
		const event = this.event
		this.journeyUpdating = true
		try {
			await this.journeyStore.delete(event.id)
		} catch (err) {
			this.logger.warn('Failed to remove journey', { error: err })
		} finally {
			this.journeyUpdating = false
		}
	}

	/** Unconditional cleanup on component detach to prevent listener leaks */
	public detaching(): void {
		window.removeEventListener('popstate', this.onPopstate)
	}
}
