import { I18N } from '@aurelia/i18n'
import { bindable, IEventAggregator, ILogger, resolve } from 'aurelia'
import { SNACK_LONG_MS, Snack } from '../../../shared/ui/snack-bar/snack'
import { IHistory } from '../../adapter/browser/history'
import { HYPE_TIERS } from '../../adapter/view/hype-display'
import { HYPE_ORDER } from '../../entities/concert'
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
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IFollowStore } from '../../services/follow-store'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import {
	eventBackgroundUrl,
	eventCalendarUrl,
	eventGoogleMapsUrl,
	eventOpenTimeOrFallback,
} from './event-detail-utils'
import type { HypeLevel, JourneyStatus, LiveEvent } from './live-event'

/**
 * How long after the calendar link the page must have become hidden to count
 * as having left the app's view. A browser that opens the calendar without
 * hiding the page (or without firing `visibilitychange`) shows the snack once
 * this has passed.
 */
export const CALENDAR_RETURN_FALLBACK_MS = 1000

/** Statuses whose save may raise the artist's hype level on the server. */
const RAISING_STATUSES: ReadonlySet<JourneyStatus> = new Set([
	'applied',
	'unpaid',
	'paid',
])

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

	/**
	 * Whether the sheet manages browser history on open/close. On the dashboard
	 * (the default) it pushes `/concerts/:id` and restores `/dashboard` so the
	 * back button closes the sheet and the deep-link URL is shareable. On the
	 * landing page there is no such route, so the host sets this `false` to avoid
	 * changing the URL (a reload of `/concerts/:id` or `/dashboard` would navigate
	 * the anonymous visitor away from Welcome).
	 */
	@bindable public manageHistory = true

	/**
	 * Optional coach-style hint rendered above the action buttons. The landing
	 * page sets it to explain that venue and goods info are one tap away; the
	 * dashboard leaves it unset so nothing extra shows there.
	 */
	@bindable public actionsHint?: string

	public isOpen = false
	public journeyUpdating = false
	public followUpdating = false

	/** Canonical label/icon/hue per status, sourced once for every node. */
	public readonly journeyConfig = JOURNEY_STATUS_CONFIG_MAP

	private readonly logger = resolve(ILogger).scopeTo('EventDetailSheet')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly authService = resolve(IAuthService)
	private readonly followStore = resolve(IFollowStore)
	private readonly history = resolve(IHistory)
	/** Where a programmatic close returns to; recorded when the sheet opens. */
	private returnUrl = '/dashboard'
	private readonly analytics = resolve(IAnalyticsService)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	/** Releases the wait for the fan's return from the calendar, if armed. */
	private releaseReturnWatch: () => void = () => {}
	/** Events whose Tracking the calendar add inferred and the fan has not changed since. */
	private readonly inferredEventIds = new Set<string>()

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
		return eventBackgroundUrl(this.event)
	}

	public get googleMapsUrl(): string {
		return eventGoogleMapsUrl(this.event)
	}

	public get calendarUrl(): string {
		return eventCalendarUrl(this.event)
	}

	/** The fan opened the concert's source link (the link itself navigates). */
	public onSourceOpened(): void {
		if (!this.event) return
		this.analytics.capture(Events.ConcertSourceClicked, {
			event_id: this.event.id,
			artist_id: this.event.artistId,
		})
	}

	/**
	 * The fan opened the add-to-calendar link (the link itself navigates). For a
	 * signed-in fan with no journey for the event, this starts tracking it as an
	 * inference at once, before the browser leaves, and shows the undo snack
	 * when the fan comes back to the app.
	 */
	public onCalendarOpened(): void {
		if (!this.event) return
		this.analytics.capture(Events.ConcertCalendarAdded, {
			event_id: this.event.id,
			artist_id: this.event.artistId,
			surface: 'detail_sheet',
		})
		if (!this.isAuthenticated || this.status !== undefined) return
		void this.inferTracking(this.event.id)
	}

	private async inferTracking(eventId: string): Promise<void> {
		// Watch for the return from the click on, so a calendar that hides the
		// page before the RPC answers is still seen.
		const returned = this.waitForReturn()
		let started: boolean
		try {
			started = await this.journeyStore.inferTracking(eventId)
		} catch (err) {
			this.releaseReturnWatch()
			this.logger.warn('Failed to start tracking from the calendar', {
				error: err,
			})
			return
		}
		if (!started) {
			this.releaseReturnWatch()
			return
		}
		this.inferredEventIds.add(eventId)
		await returned
		this.ea.publish(
			new Snack(this.i18n.tr('eventDetail.trackingStarted'), 'info', {
				duration: SNACK_LONG_MS,
				action: {
					label: this.i18n.tr('eventDetail.undo'),
					callback: () => void this.undoTracking(eventId),
				},
			}),
		)
	}

	/**
	 * Resolves when the fan comes back to the app after the calendar opened: the
	 * page became hidden and then visible again, or it did not become hidden
	 * within {@link CALENDAR_RETURN_FALLBACK_MS} (the calendar opened without
	 * hiding the app). One wait at a time; `detaching()` releases it.
	 */
	private waitForReturn(): Promise<void> {
		this.releaseReturnWatch()
		return new Promise((resolve) => {
			let hidden = document.visibilityState === 'hidden'
			const done = (): void => {
				release()
				resolve()
			}
			const onVisibilityChange = (): void => {
				if (document.visibilityState === 'hidden') hidden = true
				else if (hidden) done()
			}
			const timer = setTimeout(() => {
				if (!hidden) done()
			}, CALENDAR_RETURN_FALLBACK_MS)
			const release = (): void => {
				clearTimeout(timer)
				document.removeEventListener('visibilitychange', onVisibilityChange)
				this.releaseReturnWatch = () => {}
			}
			document.addEventListener('visibilitychange', onVisibilityChange)
			this.releaseReturnWatch = release
		})
	}

	/**
	 * Undo an inferred Tracking: the journey is removed. A status the fan saved
	 * for the event after the inference is theirs and is kept.
	 */
	private async undoTracking(eventId: string): Promise<void> {
		if (
			!this.inferredEventIds.has(eventId) ||
			this.journeyStore.statusFor(eventId) !== 'tracking'
		)
			return
		this.inferredEventIds.delete(eventId)
		try {
			await this.journeyStore.delete(eventId)
		} catch (err) {
			this.logger.warn('Failed to undo the inferred tracking', { error: err })
			this.ea.publish(
				new Snack(this.i18n.tr('eventDetail.undoFailed'), 'error'),
			)
		}
	}

	public open(
		event: LiveEvent,
		source: EventSource = 'page',
		isAllNearby = false,
	): void {
		this.event = event
		this.isAllNearby = isAllNearby
		const alreadyOpen = this.isOpen
		this.isOpen = true

		if (this.manageHistory) {
			// The address the fan is on, its query included (the dashboard's
			// filters, Discovery's `view=nearby`), so closing returns to exactly
			// it. A deep-linked `/concerts/:id` has no list address of its own
			// yet and returns to the dashboard. Only when the sheet was closed:
			// opening another concert over an open sheet keeps the address from
			// before the first one.
			if (!alreadyOpen) {
				const { pathname, search } = window.location
				this.returnUrl = pathname.startsWith('/concerts/')
					? '/dashboard'
					: `${pathname}${search}`
			}
			// Push URL without triggering Aurelia Router navigation — the sheet is an
			// overlay on the dashboard, not a separate route component. A full navigation
			// would destroy and recreate the dashboard component (and this sheet).
			this.history.pushState(
				{ concertId: event.id },
				'',
				`/concerts/${event.id}`,
			)

			// Listen for browser back navigation (popstate) to close the sheet.
			window.addEventListener('popstate', this.onPopstate)
		}

		this.errorBoundary.addBreadcrumb('action', 'open_event_detail')
		// Fire after the sheet state flips — listeners observe consistent state.
		this.analytics.capture(Events.ConcertDetailViewed, {
			event_id: event.id,
			artist_id: event.artistId,
			source,
		})
	}

	/**
	 * Programmatic close — returns to the address the fan was on when the sheet
	 * opened, query included, when this sheet manages history. A bare
	 * `/dashboard` here would drop the filters still shown behind the sheet, and
	 * on Discovery it would leave the page altogether on a reload.
	 */
	public close(): void {
		if (!this.isOpen) return
		this.isOpen = false
		if (this.manageHistory) {
			window.removeEventListener('popstate', this.onPopstate)
			this.history.replaceState(null, '', this.returnUrl)
		}
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
		return eventOpenTimeOrFallback(this.event)
	}

	public async setJourneyStatus(status: JourneyStatus): Promise<void> {
		if (!this.event || this.journeyUpdating) return
		// Capture the event so a sheet reopen on a different concert mid-request
		// cannot redirect the write to the wrong event after the await.
		const event = this.event
		this.journeyUpdating = true
		// The fan's own status replaces the inferred one, so its undo no longer
		// applies.
		this.inferredEventIds.delete(event.id)
		// The level before the save is read from the server, not the session's
		// follow list, so a level set on another device is not taken for the
		// app's raise and its undo never writes back an outdated level.
		const before =
			RAISING_STATUSES.has(status) && !event.matched
				? await this.hypeBeforeSave(event)
				: undefined
		try {
			// Write-through the store (the single source of truth); it updates its
			// observable map on success, which re-renders this sheet and the
			// Dashboard without a re-fetch. No local `event.journeyStatus` copy.
			await this.journeyStore.setStatus(event.id, status)
		} catch (err) {
			this.logger.warn('Failed to set journey status', { error: err })
			return
		} finally {
			this.journeyUpdating = false
		}
		if (before) {
			await this.showHypeRaise(event, before)
		}
	}

	/** The artist's hype level on the server, or undefined when unreadable. */
	private async hypeBeforeSave(
		event: LiveEvent,
	): Promise<HypeLevel | undefined> {
		if (!event.artistId) return undefined
		try {
			return await this.followStore.rereadHype(event.artistId)
		} catch (err) {
			this.logger.warn('Failed to read the hype level before a journey', {
				error: err,
			})
			return undefined
		}
	}

	/**
	 * After a saved Applied, Unpaid or Paid for a concert the fan's level did not
	 * match, the server may have raised the artist's hype level. Re-read it and,
	 * when it was raised, offer to undo it. The previous level was read from the
	 * server just before the save.
	 */
	private async showHypeRaise(
		event: LiveEvent,
		previous: HypeLevel,
	): Promise<void> {
		const artistId = event.artistId
		if (!artistId) return
		let current: HypeLevel | undefined
		try {
			current = await this.followStore.rereadHype(artistId)
		} catch (err) {
			// The journey is saved; only the snack is lost.
			this.logger.warn('Failed to re-read the hype level after a journey', {
				error: err,
			})
			return
		}
		if (!current || HYPE_ORDER[current] <= HYPE_ORDER[previous]) return
		this.ea.publish(
			new Snack(
				this.i18n.tr('eventDetail.hypeRaised', {
					name: event.artistName,
					hype: HYPE_TIERS[current].label,
				}),
				'info',
				{
					duration: SNACK_LONG_MS,
					action: {
						label: this.i18n.tr('eventDetail.undo'),
						callback: () => void this.undoHypeRaise(artistId, previous),
					},
				},
			),
		)
	}

	/** Undo a raise: the previous level is saved as the fan's own choice. */
	private async undoHypeRaise(
		artistId: string,
		previous: HypeLevel,
	): Promise<void> {
		try {
			await this.followStore.setHype(artistId, previous)
		} catch (err) {
			this.logger.warn('Failed to undo the hype raise', { error: err })
			this.ea.publish(
				new Snack(this.i18n.tr('eventDetail.undoFailed'), 'error'),
			)
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
		this.releaseReturnWatch()
	}
}
