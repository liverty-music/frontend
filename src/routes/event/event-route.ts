import { I18N } from '@aurelia/i18n'
import type { IRouteViewModel, Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import type { EventDateTab } from '../../components/event-date-tabs/event-date-tabs'
import { Snack } from '../../components/snack-bar/snack'
import type { Artist } from '../../entities/artist'
import type { TicketSale } from '../../entities/ticket-sale'
import { IAuthService } from '../../services/auth-service'
import { IFollowStore } from '../../services/follow-store'
import { IPurchasedTicketStore } from '../../services/purchased-ticket-store'
import { IUserStore } from '../../services/user-store'
import {
	buildIcs,
	canonicalEventUrl,
	type DateNavMode,
	dateNavMode,
	type EventPageEvent,
	type EventPerformer,
	eventFromProto,
	formatEventDate,
	formatEventTime,
	formatSaleStart,
	formatTabDate,
	googleMapsUrl,
	isEnded,
	prefectureLabel,
} from './event-page'

/**
 * - `loading`: the event read is in flight.
 * - `ready`: the event is shown.
 * - `not-found`: the event has no page (unknown, discovered, draft, unlisted).
 * - `error`: the read failed for another reason; a retry is offered.
 */
export type EventPageState = 'loading' | 'ready' | 'not-found' | 'error'

/**
 * The public Event page (`/events/:id`): one Event of a first-party Series.
 * Guests and signed-in fans alike open it; it starts loading without waiting
 * for the sign-in state (`data.auth === false`).
 */
export class EventRoute implements IRouteViewModel {
	private readonly logger = resolve(ILogger).scopeTo('EventRoute')
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly ticketSaleClient = resolve(ITicketSaleRpcClient)
	private readonly authService = resolve(IAuthService)
	private readonly followStore = resolve(IFollowStore)
	private readonly purchasedTickets = resolve(IPurchasedTicketStore)
	private readonly userStore = resolve(IUserStore)

	public state: EventPageState = 'loading'
	public event: EventPageEvent | null = null
	/** All Events of the Series in date order; empty until they load. */
	public seriesEvents: EventPageEvent[] = []
	/** The event's first-come sale; null until loaded, or when it has none. */
	public sale: TicketSale | null = null
	public followUpdatingId = ''
	/**
	 * False until the fan's follows are loaded. The follow controls stay
	 * disabled until then, so a tap cannot race the load, whose result would
	 * overwrite the tap's optimistic state.
	 */
	public followsLoaded = false

	private eventId = ''
	private abortController: AbortController | null = null

	public loading(params: Params): void {
		this.eventId = params.id ?? ''
		// Never hold the view swap on data: start the read and return.
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	/** Read the event, then the Series' dates and the fan's tickets. */
	public async load(): Promise<void> {
		this.abortController?.abort()
		const controller = new AbortController()
		this.abortController = controller
		const { signal } = controller

		this.state = 'loading'
		this.event = null
		this.seriesEvents = []
		this.sale = null
		this.followsLoaded = false
		try {
			const proto = await this.concertClient.get(this.eventId, signal)
			const event = eventFromProto(proto)
			if (!event) {
				this.state = 'not-found'
				return
			}
			this.event = event
			this.state = 'ready'
		} catch (err) {
			if (signal.aborted) return
			if (ConnectError.from(err).code === Code.NotFound) {
				this.state = 'not-found'
				return
			}
			this.logger.warn('Event read failed', {
				eventId: this.eventId,
				error: err,
			})
			this.state = 'error'
			return
		}

		// None blocks the page: the dates, the sale, the follow state and the
		// purchased line fill in.
		void this.loadSeriesEvents(this.event.seriesId, signal)
		void this.loadSale(signal)
		void this.loadFollowed(signal)
		void this.loadPurchasedTickets(signal)
	}

	private async loadSeriesEvents(
		seriesId: string,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const protos = await this.concertClient.listBySeries(seriesId, signal)
			if (signal.aborted) return
			this.seriesEvents = protos.flatMap((p) => {
				const e = eventFromProto(p)
				return e ? [e] : []
			})
		} catch (err) {
			if (signal.aborted) return
			// The other dates are optional; the page stands without them.
			this.logger.warn('Series dates read failed', { seriesId, error: err })
		}
	}

	/** Load the event's sale; the ticket section shows it once it arrives. */
	private async loadSale(signal: AbortSignal): Promise<void> {
		try {
			const sale = await this.ticketSaleClient.get(this.eventId, signal)
			if (!signal.aborted) this.sale = sale
		} catch (err) {
			if (signal.aborted) return
			// The section falls back to the sign-up hint without a sale.
			this.logger.warn('Ticket sale read failed', {
				eventId: this.eventId,
				error: err,
			})
		}
	}

	/**
	 * Load the fan's follows so each performer's control shows whether it is
	 * already followed. A guest's follows are local; a signed-in fan's come
	 * from the backend, which no other surface may have loaded yet when the
	 * fan lands here from a shared link.
	 */
	private async loadFollowed(signal: AbortSignal): Promise<void> {
		try {
			await this.authService.ready
			if (signal.aborted) return
			await this.followStore.listFollowed(signal)
		} catch (err) {
			if (signal.aborted) return
			this.logger.warn('Follow list read failed', { error: err })
		}
		// On failure the controls still work; they just start from what the
		// store already holds.
		if (!signal.aborted) this.followsLoaded = true
	}

	private async loadPurchasedTickets(signal: AbortSignal): Promise<void> {
		try {
			await this.authService.ready
			if (signal.aborted || !this.authService.isAuthenticated) return
			await this.purchasedTickets.load(signal)
		} catch (err) {
			if (signal.aborted) return
			// The purchased line is optional; the page stands without it.
			this.logger.warn('Ticket read failed', { error: err })
		}
	}

	public retry(): void {
		void this.load()
	}

	// --- Derived view ---

	private get lang(): string {
		return this.userStore.currentLanguage
	}

	public get dateLabel(): string {
		return this.event ? formatEventDate(this.event, this.lang) : ''
	}

	public get openTimeLabel(): string {
		return this.event?.openTime ? formatEventTime(this.event.openTime) : ''
	}

	public get startTimeLabel(): string {
		return this.event?.startTime ? formatEventTime(this.event.startTime) : ''
	}

	public get prefecture(): string {
		return this.event ? prefectureLabel(this.event, this.lang) : ''
	}

	public get mapsUrl(): string {
		return this.event ? googleMapsUrl(this.event, this.lang) : '#'
	}

	public get isCancelled(): boolean {
		return this.event?.cancelled ?? false
	}

	public get isEnded(): boolean {
		return this.event ? isEnded(this.event) : false
	}

	/** The ticket section is shown unless the event has ended. */
	public get showTicketSection(): boolean {
		return !this.isEnded
	}

	/** Issued tickets the signed-in fan holds for this event. */
	public get purchasedCount(): number {
		if (!this.authService.isAuthenticated) return 0
		return this.purchasedTickets.countFor(this.event?.id)
	}

	public get isGuest(): boolean {
		return !this.authService.isAuthenticated
	}

	/** The sale to show in the ticket section; none for a cancelled concert. */
	public get shownSale(): TicketSale | null {
		return this.isCancelled ? null : this.sale
	}

	/** The sale start in Japan time, e.g. "2026年11月1日(日) 10:00". */
	public get saleStartLabel(): string {
		return this.sale ? formatSaleStart(this.sale.saleStart, this.lang) : ''
	}

	/** The price of one ticket with thousands separators, e.g. "3,000". */
	public get salePrice(): string {
		return this.sale ? this.sale.price.toLocaleString('ja-JP') : ''
	}

	/** Where the action to buy leads a signed-in fan. */
	public get checkoutUrl(): string {
		return this.event ? `/events/${this.event.id}/checkout` : '#'
	}

	public get dateNav(): DateNavMode {
		return dateNavMode(this.seriesEvents)
	}

	public get dateTabs(): EventDateTab[] {
		return this.seriesEvents.map((e) => ({
			id: e.id,
			label: formatTabDate(e, this.lang),
			selected: e.id === this.event?.id,
		}))
	}

	/** The Series' other Events, for a Series with more dates than tabs. */
	public get otherDates(): { id: string; label: string }[] {
		return this.seriesEvents
			.filter((e) => e.id !== this.event?.id)
			.map((e) => ({ id: e.id, label: formatEventDate(e, this.lang) }))
	}

	/** Where "the artist's other concerts" leads: the Home timetable for them. */
	public get otherConcertsUrl(): string {
		const id = this.event?.performers[0]?.id
		return id ? `/dashboard?artists=${encodeURIComponent(id)}` : '/dashboard'
	}

	/**
	 * Ids of the artists the fan follows. The template reads `.has(id)` on this
	 * getter rather than calling a method, so the binding observes the store's
	 * follow list and updates when a follow changes.
	 */
	public get followedIds(): ReadonlySet<string> {
		return this.followStore.followedIds
	}

	public isFollowed(performer: EventPerformer): boolean {
		return this.followedIds.has(performer.id)
	}

	// --- Actions ---

	public async toggleFollow(performer: EventPerformer): Promise<void> {
		if (this.followUpdatingId || !this.followsLoaded) return
		this.followUpdatingId = performer.id
		try {
			if (this.isFollowed(performer)) {
				await this.followStore.unfollow(performer.id)
			} else {
				const artist: Artist = {
					id: performer.id,
					name: performer.name,
					mbid: performer.mbid,
				}
				await this.followStore.follow(artist)
			}
		} catch (err) {
			this.logger.warn('Follow toggle failed', {
				artistId: performer.id,
				error: err,
			})
			this.ea.publish(
				new Snack(this.i18n.tr('eventPage.follow.failed'), 'error'),
			)
		} finally {
			this.followUpdatingId = ''
		}
	}

	/** The canonical URL of this Event page, without any query. */
	public get shareUrl(): string {
		return this.event
			? canonicalEventUrl(window.location.origin, this.event.id)
			: ''
	}

	/** Share with the Web Share API, or copy the link where it is missing. */
	public async share(): Promise<void> {
		if (!this.event) return
		const url = this.shareUrl
		if (typeof navigator.share === 'function') {
			try {
				await navigator.share({ title: this.event.title, url })
			} catch (err) {
				// A dismissed share sheet is not an error.
				if ((err as Error).name !== 'AbortError') {
					this.logger.warn('Share failed', { error: err })
				}
			}
			return
		}
		try {
			await navigator.clipboard.writeText(url)
			this.ea.publish(new Snack(this.i18n.tr('eventPage.share.copied')))
		} catch (err) {
			this.logger.warn('Copy link failed', { error: err })
			this.ea.publish(
				new Snack(this.i18n.tr('eventPage.share.failed'), 'error'),
			)
		}
	}

	/** Download the event as an .ics calendar file. */
	public addToCalendar(): void {
		if (!this.event) return
		const blob = new Blob([buildIcs(this.event, this.shareUrl)], {
			type: 'text/calendar;charset=utf-8',
		})
		const href = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = href
		a.download = `liverty-music-${this.event.id}.ics`
		a.click()
		URL.revokeObjectURL(href)
	}

	/**
	 * Start sign-up from this page: the fan comes back to this Event page, and
	 * the post-signup celebration and dialog are skipped.
	 */
	public async signUp(): Promise<void> {
		if (!this.event) return
		await this.authService.signUp({
			origin: 'event-page',
			returnTo: `/events/${this.event.id}`,
		})
	}
}
