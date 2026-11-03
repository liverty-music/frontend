import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { bindable, IEventAggregator, ILogger, resolve } from 'aurelia'
import {
	SNACK_LONG_MS,
	Snack,
	type SnackAction,
} from '../../../shared/ui/snack-bar/snack'
import { IHistory } from '../../adapter/browser/history'
import { hypeReachWords } from '../../adapter/view/hype-display'
import { HYPE_ORDER, isHypeMatched } from '../../entities/concert'
import {
	JOURNEY_STATUS_CONFIG_MAP,
	type JourneyStatusConfig,
} from '../../entities/ticket-journey'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import type { EventSource } from '../../services/analytics-events'
import { IAuthService } from '../../services/auth-service'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IFollowStore } from '../../services/follow-store'
import {
	IPushOfferService,
	type PushState,
} from '../../services/push-offer-service'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserStore } from '../../services/user-store'
import { currentLanguage } from '../../util/change-locale'
import {
	eventBackgroundUrl,
	eventCalendarUrl,
	eventGoogleMapsUrl,
	eventOpenTimeOrFallback,
} from './event-detail-utils'
import type {
	HypeLevel,
	JourneyStatus,
	LaneType,
	LiveEvent,
} from './live-event'

/**
 * How long after the calendar link the page must have become hidden to count
 * as having left the app's view. A browser that opens the calendar without
 * hiding the page (or without firing `visibilitychange`) shows the snack once
 * this has passed.
 */
export const CALENDAR_RETURN_FALLBACK_MS = 1000

/** The statuses of the row under the notification button, in journey order. */
const ROW_STATUSES: readonly JourneyStatus[] = [
	'applied',
	'unpaid',
	'paid',
	'lost',
]

/** The lowest hype level that matches a concert in each lane. */
const LOWEST_MATCHING_HYPE: Readonly<Record<LaneType, HypeLevel>> = {
	home: 'home',
	nearby: 'nearby',
	away: 'away',
}

/** The push line under the ticket section's controls. */
export interface PushLine {
	key: string
	/** Whether the line carries the push offer (or 「設定」) as its action. */
	offer: boolean
}

/** The out-of-range notice: what the level pushes now, or after widening. */
export interface OutOfRangeNotice {
	/** Place words of the current level; null for Watch. */
	currentPlaces: string | null
	/** Label of the button that sets the lowest matching level. */
	actionLabel: string
	/** Set once the widened level is saved. */
	saved: boolean
	savedKey: string
	savedPlaces: string | null
}

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
	public hypeUpdating = false

	/** What push means for this browser; read each time the sheet opens. */
	public pushState: PushState | null = null

	/** The four statuses of the row, with their canonical label, icon and hue. */
	public readonly rowStatuses: readonly JourneyStatusConfig[] =
		ROW_STATUSES.map((status) => JOURNEY_STATUS_CONFIG_MAP[status])

	/** The event whose out-of-range level the fan widened, and to what. */
	private widened: { eventId: string; hype: HypeLevel } | null = null

	private readonly logger = resolve(ILogger).scopeTo('EventDetailSheet')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly authService = resolve(IAuthService)
	private readonly followStore = resolve(IFollowStore)
	private readonly pushOffer = resolve(IPushOfferService)
	private readonly userStore = resolve(IUserStore)
	private readonly router = resolve(IRouter)
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
	/** Events whose calendar inference is in flight, so a second tap is ignored. */
	private readonly inferringEventIds = new Set<string>()
	/** The fan's return the in-flight inferences wait for, shared by all. */
	private returnWait: Promise<void> | null = null

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

	public attaching(): void {
		void this.refreshPushState()
	}

	/** Each concert shown reads the push state afresh: it changes in Settings. */
	public eventChanged(): void {
		void this.refreshPushState()
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
		// A second tap while the first inference is in flight changes nothing:
		// the first one already waits for the fan's return.
		if (this.inferringEventIds.has(this.event.id)) return
		void this.inferTracking(this.event.id)
	}

	private async inferTracking(eventId: string): Promise<void> {
		this.inferringEventIds.add(eventId)
		try {
			await this.inferTrackingOnce(eventId)
		} finally {
			this.inferringEventIds.delete(eventId)
		}
	}

	private async inferTrackingOnce(eventId: string): Promise<void> {
		// Watch for the return from the click on, so a calendar that hides the
		// page before the RPC answers is still seen.
		const returned = this.waitForReturn()
		let started: boolean
		try {
			started = await this.journeyStore.inferTracking(eventId)
		} catch (err) {
			this.logger.warn('Failed to start tracking from the calendar', {
				error: err,
			})
			return
		}
		if (!started) return
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
	 * hiding the app). Inferences started while a wait runs share it, so a wait
	 * is never ended early by a newer one. `detaching()` ends it at once: the
	 * sheet is gone, so a started inference shows its undo then.
	 */
	private waitForReturn(): Promise<void> {
		if (this.returnWait) return this.returnWait
		this.returnWait = new Promise((resolve) => {
			let hidden = document.visibilityState === 'hidden'
			const onVisibilityChange = (): void => {
				if (document.visibilityState === 'hidden') hidden = true
				else if (hidden) finish()
			}
			const timer = setTimeout(() => {
				if (!hidden) finish()
			}, CALENDAR_RETURN_FALLBACK_MS)
			const finish = (): void => {
				clearTimeout(timer)
				document.removeEventListener('visibilitychange', onVisibilityChange)
				this.returnWait = null
				this.releaseReturnWatch = () => {}
				resolve()
			}
			document.addEventListener('visibilitychange', onVisibilityChange)
			this.releaseReturnWatch = finish
		})
		return this.returnWait
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
		if (this.widened?.eventId !== event.id) this.widened = null
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

	/** The notification button is hidden once tickets are paid. */
	public get showNotifyButton(): boolean {
		return this.status !== 'paid'
	}

	public get notifyLabelKey(): string {
		if (this.status === 'tracking') return 'eventDetail.notify.active'
		if (this.status === 'lost') return 'eventDetail.notify.next'
		return 'eventDetail.notify.start'
	}

	/**
	 * The notification button's style: selected while tracking, the section's
	 * primary button with no status or after losing, secondary otherwise.
	 */
	public get notifyEmphasis(): 'selected' | 'primary' | 'secondary' {
		const status = this.status
		if (status === 'tracking') return 'selected'
		if (status === undefined || status === 'lost') return 'primary'
		return 'secondary'
	}

	/** The shared button's outlined variant marks the secondary style. */
	public get notifyVariant(): 'outlined' | undefined {
		return this.notifyEmphasis === 'secondary' ? 'outlined' : undefined
	}

	/**
	 * A guest's press starts sign-up and tracks the event once the account
	 * exists; a fan's press starts tracking, or stops it while tracking.
	 */
	public onNotifyPressed(): void {
		if (!this.isAuthenticated) {
			this.startTrackingSignUp()
			return
		}
		if (this.status === 'tracking') void this.removeJourney()
		else void this.setJourneyStatus('tracking')
	}

	/** Pressing an unselected status sets it; pressing the selected one clears it. */
	public onStatusPressed(status: JourneyStatus): void {
		if (this.status === status) void this.removeJourney()
		else void this.setJourneyStatus(status)
	}

	private startTrackingSignUp(): void {
		const event = this.event
		if (!event) return
		this.errorBoundary.addBreadcrumb('action', 'start_sign_up')
		void this.authService.signUp({
			uiLocales: currentLanguage(this.i18n),
			source: 'ticket_notify',
			returnTo: `/concerts/${event.id}`,
			trackEventId: event.id,
		})
	}

	/** The line saying what the current status brings by push. */
	public get pushLine(): PushLine | null {
		if (!this.isAuthenticated) {
			return { key: 'eventDetail.pushLine.guest', offer: false }
		}
		const on = this.pushState === 'on'
		switch (this.status) {
			case undefined:
				return { key: 'eventDetail.pushLine.none', offer: false }
			case 'tracking':
				if (this.pushState === null) return null
				return on
					? { key: 'eventDetail.pushLine.trackingOn', offer: false }
					: { key: 'eventDetail.pushLine.trackingOff', offer: true }
			case 'applied':
				if (this.pushState === null) return null
				return on
					? { key: 'eventDetail.pushLine.appliedOn', offer: false }
					: { key: 'eventDetail.pushLine.appliedOff', offer: true }
			case 'unpaid':
				return { key: 'eventDetail.pushLine.unpaid', offer: false }
			default:
				return null
		}
	}

	/**
	 * The action that turns push on where it is off: the push offer, 「設定」
	 * where the browser blocked or cannot receive push, or 「登録する」 for a
	 * guest. None while push is on.
	 */
	public get pushAction(): SnackAction | null {
		if (!this.isAuthenticated) {
			return {
				label: this.i18n.tr('hypeReach.signUp'),
				callback: () => this.onSignupRequested?.() ?? this.startSignUp(),
			}
		}
		if (this.pushState === 'offerable') {
			return {
				label: this.i18n.tr('pushOffer.action'),
				callback: () => {
					// Called within the press, so the browser prompt follows it.
					void this.pushOffer
						.accept({ source: 'event_detail_sheet' })
						.then(() => this.refreshPushState())
				},
			}
		}
		if (this.pushState === 'settings') {
			return {
				label: this.i18n.tr('hypeReach.settings'),
				callback: () => {
					this.close()
					void this.router.load('settings')
				},
			}
		}
		return null
	}

	private startSignUp(): void {
		this.errorBoundary.addBreadcrumb('action', 'start_sign_up')
		void this.authService.signUp({
			uiLocales: currentLanguage(this.i18n),
			source: 'ticket_notify',
		})
	}

	private async refreshPushState(): Promise<void> {
		this.pushState = await this.pushOffer.pushState()
	}

	/**
	 * The notice shown when the fan follows the concert's artist at a level
	 * that does not match the concert, or the line after the fan widened it.
	 */
	public get outOfRange(): OutOfRangeNotice | null {
		const event = this.event
		const lane = event?.lane
		if (!event || !lane || !event.artistId) return null
		if (!this.followStore.followedIds.has(event.artistId)) return null
		const home = this.userStore.currentHome ?? undefined
		const words = (hype: HypeLevel) =>
			hypeReachWords(hype, home, (key, options) => this.i18n.tr(key, options))
		const target = LOWEST_MATCHING_HYPE[lane]
		const widened = this.widened?.eventId === event.id ? this.widened : null
		if (widened) {
			const on = this.isAuthenticated && this.pushState === 'on'
			return {
				currentPlaces: null,
				actionLabel: '',
				saved: true,
				savedKey: on
					? 'eventDetail.outOfRange.savedOn'
					: 'eventDetail.outOfRange.savedOff',
				savedPlaces: words(widened.hype),
			}
		}
		const hype = this.followStore.hypeByArtist.get(event.artistId)
		if (!hype || isHypeMatched(hype, lane)) return null
		// 「も」 when the new level still pushes what the current one does.
		const also = hype !== 'watch' && target !== 'away'
		return {
			currentPlaces: words(hype),
			actionLabel: this.i18n.tr(
				also
					? 'eventDetail.outOfRange.widenAlso'
					: 'eventDetail.outOfRange.widen',
				{ places: words(target) },
			),
			saved: false,
			savedKey: '',
			savedPlaces: null,
		}
	}

	/**
	 * Set the artist's hype level to the lowest level that matches the
	 * concert, as the fan's own choice. The Dashboard highlight follows from
	 * the follow store. A failed save keeps the notice and says so.
	 */
	public async widenHype(): Promise<void> {
		const event = this.event
		const lane = event?.lane
		if (!event || !lane || !event.artistId || this.hypeUpdating) return
		const target = LOWEST_MATCHING_HYPE[lane]
		this.hypeUpdating = true
		try {
			await this.followStore.setHype(event.artistId, target)
			this.widened = { eventId: event.id, hype: target }
		} catch (err) {
			this.logger.warn('Failed to widen the hype level', { error: err })
			this.ea.publish(
				new Snack(this.i18n.tr('eventDetail.outOfRange.failed'), 'error'),
			)
		} finally {
			this.hypeUpdating = false
		}
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
		// The words of the My Artists hype snack, with 「取り消す」 in place of
		// the push offer.
		const raised = current
		const pushOn = (await this.pushOffer.pushState()) === 'on'
		this.ea.publish(
			new Snack(
				this.i18n.tr(pushOn ? 'hypeReach.on' : 'hypeReach.off', {
					name: event.artistName,
					places: hypeReachWords(
						raised,
						this.userStore.currentHome ?? undefined,
						(key, options) => this.i18n.tr(key, options),
					),
				}),
				'info',
				{
					duration: SNACK_LONG_MS,
					action: {
						label: this.i18n.tr('eventDetail.undo'),
						callback: () =>
							void this.undoHypeRaise(artistId, previous, current),
					},
				},
			),
		)
	}

	/**
	 * Undo a raise: the previous level is saved as the fan's own choice. When
	 * the level is no longer the raised one (the fan changed it since), the
	 * fan's newer choice is kept.
	 */
	private async undoHypeRaise(
		artistId: string,
		previous: HypeLevel,
		raised: HypeLevel,
	): Promise<void> {
		if (this.followStore.hypeByArtist.get(artistId) !== raised) return
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
