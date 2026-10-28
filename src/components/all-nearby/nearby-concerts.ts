import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { bindable, ILogger, resolve } from 'aurelia'
import {
	displayName,
	type GeoLocationInit,
	geoLocationFromLevel1,
} from '../../entities/user'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IPurchasedTicketStore } from '../../services/purchased-ticket-store'
import { IUserStore } from '../../services/user-store'
import type { EventDetailSheet } from '../live-highway/event-detail-sheet'
import type { DateGroup, LiveEvent } from '../live-highway/live-event'
import type { UserHomeSelector } from '../user-home-selector/user-home-selector'
import { type DateRange, rangeCacheKey } from './date-presets'
import type { DateRangeSheet, RangeChangedDetail } from './date-range-sheet'

/**
 * What the All Nearby view keeps for one visit to Discovery, owned by the
 * route so switching to the artist bubbles and back (which re-creates the
 * view) finds the same area, date range and fetched results. A new visit
 * starts from a new instance; nothing here is persisted.
 */
export class NearbyVisit {
	/** Results keyed by (adminArea + from + to); see `rangeCacheKey`. */
	public readonly cache = new Map<string, DateGroup[]>()
	/**
	 * Area override, an ISO 3166-2 code chosen with the area chip. Null means
	 * "use the fan's home area". Never saved to the account or the device.
	 */
	public areaCode: string | null = null
	/** The applied date range; null until the date-range sheet first emits. */
	public range: DateRange | null = null
}

/**
 * The All Nearby view: every concert near an area within a period, including
 * artists the fan does not follow, listed in the two-lane (HOME / NEAR)
 * timetable. Its filters are an area chip and a date chip, each opening a
 * bottom sheet; a discovered concert opens the event detail sheet with the
 * follow action, a first-party one opens its Event page.
 */
export class NearbyConcerts {
	/** The visit's state, owned by the host route. */
	@bindable public visit: NearbyVisit = new NearbyVisit()

	/**
	 * Invoked when a guest taps the follow action. The host shows the sign-up
	 * prompt banner, outside this view: the banner is fixed to the viewport,
	 * and Discovery's layout is a container that would anchor it instead.
	 */
	@bindable public onSignupRequested?: () => void

	/**
	 * The date chip's label — a preset name (今週末 / 7日以内 / 30日以内) or a
	 * localized range (e.g. `8/12〜8/20`), supplied by the date-range sheet
	 * alongside the resolved range so the chip never re-derives it.
	 */
	public dateChipLabel = ''
	public dateGroups: DateGroup[] = []
	public isLoading = false
	public loadError: unknown = null

	public areaSelector: UserHomeSelector | undefined
	public dateSheet: DateRangeSheet | undefined
	public detailSheet: EventDetailSheet | undefined

	/** The in-flight request, aborted when a filter changes or the view goes. */
	private abortController: AbortController | null = null

	private readonly logger = resolve(ILogger).scopeTo('NearbyConcerts')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertStore = resolve(IConcertStore)
	private readonly purchasedTickets = resolve(IPurchasedTicketStore)
	private readonly router = resolve(IRouter)
	public readonly userStore = resolve(IUserStore)

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	/** The override, else the fan's home area, else null (ask for one). */
	public get effectiveAreaCode(): string | null {
		return this.visit.areaCode ?? this.userStore.currentHome
	}

	/** Display name of the effective area, or empty when none is set. */
	public get selectedAreaName(): string {
		const code = this.effectiveAreaCode
		if (!code) return ''
		const lang = this.userStore.currentLanguage === 'ja' ? 'ja' : 'en'
		return displayName(code, lang)
	}

	/** The date-range sheet emitted a range: on bind, a preset or an apply. */
	public onRangeChanged(event: CustomEvent<RangeChangedDetail>): void {
		const { label, ...range } = event.detail
		this.visit.range = range
		this.dateChipLabel = label
		void this.load()
	}

	public openDateSheet(): void {
		this.dateSheet?.open()
	}

	public openAreaSelector(): void {
		this.areaSelector?.open()
	}

	/**
	 * Area override chosen. Kept in the visit only — never written through
	 * userStore.updateHome() or the guest home — and fetched for at once.
	 */
	public onAreaSelected(code: string): void {
		this.logger.info('All Nearby area override selected', { code })
		this.visit.areaCode = code
		void this.load()
	}

	/**
	 * The reference point for ListByLocation: the override's centroid, else the
	 * fan's home area's. Null when neither is set.
	 */
	private resolveGeoLocation(): GeoLocationInit | null {
		const code = this.effectiveAreaCode
		return code ? (geoLocationFromLevel1(code) ?? null) : null
	}

	/**
	 * Load (or serve from the visit's cache) the concerts for the current area
	 * and date range. A superseded request is aborted; the ProximityGroup[]
	 * answer is converted to DateGroup[] whose HOME and NEAR lanes the backend
	 * fills (AWAY stays empty and is hidden).
	 */
	public async load(): Promise<void> {
		const range = this.visit.range
		if (!range) return

		const geo = this.resolveGeoLocation()
		if (!geo) {
			// No area yet (a guest without a home): ask for one before any
			// location-less request.
			this.dateGroups = []
			this.loadError = null
			this.openAreaSelector()
			return
		}

		const key = rangeCacheKey(geo.adminArea, range.from, range.to)
		const cached = this.visit.cache.get(key)
		if (cached) {
			this.abortController?.abort()
			this.isLoading = false
			this.dateGroups = cached
			this.loadError = null
			return
		}

		this.abortController?.abort()
		this.abortController = new AbortController()
		const signal = this.abortController.signal

		this.isLoading = true
		this.loadError = null
		try {
			const groups = await this.concertStore.listByLocation(
				geo,
				range.from,
				range.to,
				signal,
			)
			if (signal.aborted) return
			// Each card's artist comes from the concert's own performers (these
			// artists are mostly not in the fan's follow set), so names render.
			const dateGroups = this.concertStore.toDateGroupsForLocation(
				groups,
				this.purchasedTickets.countByEvent,
			)
			this.visit.cache.set(key, dateGroups)
			this.dateGroups = dateGroups
			this.logger.info('All Nearby loaded', {
				adminArea: geo.adminArea,
				groups: dateGroups.length,
			})
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('Failed to load All Nearby', { error: err })
			this.loadError = err
			this.dateGroups = []
		} finally {
			if (!signal.aborted) this.isLoading = false
		}
	}

	/**
	 * A first-party concert opens its public Event page; a discovered one
	 * opens the detail sheet with the follow action.
	 */
	public onEventSelected(event: CustomEvent<{ event: LiveEvent }>): void {
		const concert = event.detail.event
		if (concert.isFirstParty) {
			void this.router.load(`/events/${concert.id}`)
			return
		}
		this.detailSheet?.open(concert, 'all_nearby', true)
	}

	/**
	 * A guest tapped the follow action. Following is the conversion moment, so
	 * the host's sign-up prompt banner appears instead of a guest follow,
	 * keeping the concert in view.
	 */
	public onFollowSignupRequested(): void {
		if (this.isAuthenticated) return
		this.onSignupRequested?.()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
