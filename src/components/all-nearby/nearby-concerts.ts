import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { bindable, ILogger, resolve, watch } from 'aurelia'
import {
	loadNearbyFilter,
	type StoredNearbyFilter,
	saveNearbyFilter,
} from '../../adapter/storage/nearby-filter-storage'
import {
	displayName,
	type GeoLocationInit,
	geoLocationFromLevel1,
} from '../../entities/user'
import { IAuthService } from '../../services/auth-service'
import {
	IConcertStore,
	type ProximityGroup,
} from '../../services/concert-store'
import { IFollowStore } from '../../services/follow-store'
import { IPurchasedTicketStore } from '../../services/purchased-ticket-store'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserStore } from '../../services/user-store'
import type { EventDetailSheet } from '../live-highway/event-detail-sheet'
import type { DateGroup, LiveEvent } from '../live-highway/live-event'
import type { UserHomeSelector } from '../user-home-selector/user-home-selector'
import {
	type DatePresetId,
	type DateRange,
	rangeCacheKey,
	resolvePreset,
} from './date-presets'
import type { DateRangeSheet, RangeChangedDetail } from './date-range-sheet'
import type { NearbyFilterRow, NearbyFilterSheet } from './nearby-filter-sheet'

/** The period a visit starts from without a kept preset: 7日以内. */
const DEFAULT_PRESET: DatePresetId = 'week'

/**
 * What the All Nearby view keeps for one visit to Discovery, owned by the
 * route so switching to the artist bubbles and back (which re-creates the
 * view) finds the same area, period and fetched results. A visit starts from
 * the filter kept on the device (`nearby-filter-storage`): the area override
 * and the last applied preset, else the home area and 7日以内.
 */
export class NearbyVisit {
	/**
	 * `ListByLocation` answers keyed by (adminArea + from + to); see
	 * `rangeCacheKey`. Kept as the server's groups, so a change of hype or
	 * journey re-derives the cards without a request.
	 */
	public readonly cache = new Map<string, ProximityGroup[]>()
	/**
	 * Area override, an ISO 3166-2 code chosen in the filter sheet. Null means
	 * "use the fan's home area". Kept on the device, never on the account.
	 */
	public areaCode: string | null
	/** The applied quick preset; null while a custom range is applied. */
	public datePreset: DatePresetId | null
	/** The applied date range. */
	public range: DateRange | null

	constructor(kept: StoredNearbyFilter = loadNearbyFilter()) {
		this.areaCode = kept.areaCode
		this.datePreset = kept.datePreset ?? DEFAULT_PRESET
		this.range = resolvePreset(this.datePreset) ?? null
	}

	/**
	 * Whether the filter differs from the default (the fan's home area and
	 * 7日以内), which lights the launcher's filter item.
	 */
	public isFiltered(homeCode: string | null): boolean {
		const areaDiffers = this.areaCode !== null && this.areaCode !== homeCode
		return areaDiffers || this.datePreset !== DEFAULT_PRESET
	}
}

/**
 * The All Nearby view: every concert near an area within a period, including
 * artists the fan does not follow, listed in the two-lane (HOME / NEAR)
 * timetable. Its filters, the area and the period, open from the action
 * launcher's filter item (the host route calls `openFilters`), so nothing sits
 * above the timetable; a discovered concert opens the event detail sheet with
 * the follow action, a first-party one opens its Event page.
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
	 * The period's label — a preset name (今週末 / 7日以内 / 30日以内) or a
	 * localized range (e.g. `8/12〜8/20`), supplied by the date-range sheet
	 * alongside the resolved range so the filter sheet never re-derives it.
	 */
	public periodLabel = ''
	public dateGroups: DateGroup[] = []
	/** The `ListByLocation` groups the cards on screen are built from. */
	private shownGroups: ProximityGroup[] = []
	public isLoading = false
	public loadError: unknown = null

	public areaSelector: UserHomeSelector | undefined
	public dateSheet: DateRangeSheet | undefined
	public filterSheet: NearbyFilterSheet | undefined
	public detailSheet: EventDetailSheet | undefined

	/** The in-flight request, aborted when a filter changes or the view goes. */
	private abortController: AbortController | null = null

	private readonly logger = resolve(ILogger).scopeTo('NearbyConcerts')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertStore = resolve(IConcertStore)
	public readonly followStore = resolve(IFollowStore)
	public readonly journeyStore = resolve(ITicketJourneyStore)
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

	public attached(): void {
		// Journeys show as badges; a visit straight to the All Nearby view may
		// come before any other screen loaded them (a guest gets an empty map
		// without a request).
		this.journeyStore.load().catch((err: unknown) => {
			this.logger.error('Failed to load journeys for All Nearby', {
				error: err,
			})
		})
	}

	/** The date-range sheet emitted a range: on bind, a preset or an apply. */
	public onRangeChanged(event: CustomEvent<RangeChangedDetail>): void {
		const { label, applied, ...range } = event.detail
		this.visit.range = range
		this.periodLabel = label
		if (applied !== undefined) {
			// A preset is kept for the next visit; a custom range is not.
			this.visit.datePreset = applied
			saveNearbyFilter({ datePreset: applied })
		}
		void this.load()
	}

	/** The launcher's filter item: the sheet with the area and period rows. */
	public openFilters(): void {
		this.filterSheet?.open()
	}

	/** A row of the filter sheet was chosen, and the sheet has closed. */
	public onFilterRowChosen(event: CustomEvent<NearbyFilterRow>): void {
		if (event.detail === 'area') this.openAreaSelector()
		else this.openDateSheet()
	}

	public openDateSheet(): void {
		this.dateSheet?.open()
	}

	public openAreaSelector(): void {
		this.areaSelector?.open()
	}

	/**
	 * Area chosen. Kept on the device as the override — never written through
	 * userStore.updateHome() or the guest home — and fetched for at once. The
	 * fan's own home area clears the override, so the view follows the home
	 * area again when it changes.
	 */
	public onAreaSelected(code: string): void {
		this.logger.info('All Nearby area selected', { code })
		const override = code === this.userStore.currentHome ? null : code
		this.visit.areaCode = override
		saveNearbyFilter({ areaCode: override })
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
			this.shownGroups = cached
			this.derive()
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
			this.visit.cache.set(key, groups)
			this.shownGroups = groups
			this.derive()
			this.logger.info('All Nearby loaded', {
				adminArea: geo.adminArea,
				groups: groups.length,
			})
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('Failed to load All Nearby', { error: err })
			this.loadError = err
			this.shownGroups = []
			this.dateGroups = []
		} finally {
			if (!signal.aborted) this.isLoading = false
		}
	}

	/**
	 * The fan's hype levels or journeys changed (a journey set in the detail
	 * sheet, a level changed on another screen): re-derive the cards from the
	 * groups on screen, without a request, as the dashboard does.
	 */
	@watch((vm: NearbyConcerts) => vm.followStore.hypeByArtist)
	@watch((vm: NearbyConcerts) => vm.journeyStore.journeyMap)
	protected onFanStateChanged(): void {
		if (this.shownGroups.length > 0) this.derive()
	}

	/**
	 * Build the cards from the groups on screen. Each card's artist comes from
	 * the concert's own performers (mostly not followed), so names render; a
	 * followed artist is matched by its hype level and lane, and a concert with
	 * a journey shows its badge, by the dashboard's rules.
	 */
	private derive(): void {
		this.dateGroups = this.concertStore.toDateGroupsForLocation(
			this.shownGroups,
			this.followStore.hypeByArtist,
			this.journeyStore.journeyMap,
			this.purchasedTickets.countByEvent,
		)
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
