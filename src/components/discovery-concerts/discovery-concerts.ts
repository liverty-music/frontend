import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { bindable, ILogger, resolve, watch } from 'aurelia'
import {
	loadConcertsFilter,
	type StoredConcertsFilter,
	saveConcertsFilter,
} from '../../adapter/storage/concerts-filter-storage'
import type { Concert, DateGroup } from '../../entities/concert'
import {
	displayName,
	type GeoLocationInit,
	geoLocationFromLevel1,
} from '../../entities/user'
import {
	IConcertStore,
	type ProximityGroup,
} from '../../services/concert-store'
import { IFollowStore } from '../../services/follow-store'
import { IGuideService } from '../../services/guide-service'
import { IPurchasedTicketStore } from '../../services/purchased-ticket-store'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserHydration } from '../../services/user-hydration-task'
import { IUserStore } from '../../services/user-store'
import { currentLanguage } from '../../util/change-locale'
import type { ConcertSheet } from '../concert-sheet/concert-sheet'
import type { HomeAreaSelector } from '../home-area-selector/home-area-selector'
import type { AreaFilterRow, AreaFilterSheet } from './area-filter-sheet'
import {
	type DatePresetId,
	type DateRange,
	rangeCacheKey,
	resolvePreset,
} from './date-presets'
import type { DateRangeSheet, RangeChangedDetail } from './date-range-sheet'

/** The period a visit starts from without a kept preset: 7日以内. */
const DEFAULT_PRESET: DatePresetId = 'week'

/**
 * What the Concerts view keeps for one visit to Discovery, owned by the
 * route so switching to the artist bubbles and back (which re-creates the
 * view) finds the same area, period and fetched results. A visit starts from
 * the filter kept on the device (`concerts-filter-storage`): the area override
 * and the last applied preset, else the home area and 7日以内.
 */
export class DiscoveryConcertsVisit {
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

	constructor(kept: StoredConcertsFilter = loadConcertsFilter()) {
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
 * The Concerts view: every concert near an area within a period, including
 * artists the fan does not follow, listed in the two-lane (HOME / NEAR)
 * timetable. Its filters, the area and the period, open from the action
 * launcher's filter item (the host route calls `openFilters`), so nothing sits
 * above the timetable; a discovered concert opens the event detail sheet with
 * the follow action, a first-party one opens its concert page.
 */
export class DiscoveryConcerts {
	/** The visit's state, owned by the host route. */
	@bindable public visit: DiscoveryConcertsVisit = new DiscoveryConcertsVisit()

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

	public areaSelector: HomeAreaSelector | undefined
	public dateSheet: DateRangeSheet | undefined
	public filterSheet: AreaFilterSheet | undefined
	public detailSheet: ConcertSheet | undefined

	/** The in-flight request, aborted when a filter changes or the view goes. */
	private abortController: AbortController | null = null

	private readonly logger = resolve(ILogger).scopeTo('DiscoveryConcerts')
	public readonly i18n = resolve(I18N)
	private readonly concertStore = resolve(IConcertStore)
	public readonly followStore = resolve(IFollowStore)
	public readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly purchasedTickets = resolve(IPurchasedTicketStore)
	private readonly router = resolve(IRouter)
	public readonly userStore = resolve(IUserStore)
	private readonly userHydration = resolve(IUserHydration)
	private readonly guide = resolve(IGuideService)

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
		// Journeys show as badges; a visit straight to the Concerts view may
		// come before any other screen loaded them (a guest gets an empty map
		// without a request).
		this.journeyStore.load().catch((err: unknown) => {
			this.logger.error('Failed to load journeys for the Concerts view', {
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
			saveConcertsFilter({ datePreset: applied })
		}
		void this.load()
	}

	/** The launcher's filter item: the sheet with the area and period rows. */
	public openFilters(): void {
		this.filterSheet?.open()
	}

	/** A row of the filter sheet was chosen, and the sheet has closed. */
	public onFilterRowChosen(event: CustomEvent<AreaFilterRow>): void {
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
		this.logger.info('the Concerts view area selected', { code })
		const override = code === this.userStore.currentHome ? null : code
		this.visit.areaCode = override
		saveConcertsFilter({ areaCode: override })
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

		// One controller per load, made before any wait, so a newer load or
		// leaving the view (detaching) stops this one wherever it is.
		this.abortController?.abort()
		this.abortController = new AbortController()
		const signal = this.abortController.signal

		let geo = this.resolveGeoLocation()
		if (!geo) {
			// The app opens Discovery without waiting for the signed-in fan's
			// account, so the home area may not be known yet: wait for it
			// rather than ask a fan who has one for an area. Settled at once
			// after boot, and not waited for when the area is already known.
			this.isLoading = true
			this.loadError = null
			await this.userHydration.ready
			if (signal.aborted) return
			geo = this.resolveGeoLocation()
		}
		if (!geo && !this.userStore.needsHome) {
			// Signed in, but the account did not load (the boot hydration
			// failed): a missing account is not a missing home, so load it
			// again, and show a retryable error if that fails too.
			try {
				await this.userStore.ensureLoaded(currentLanguage(this.i18n))
			} catch (err) {
				if (signal.aborted) return
				this.logger.error('Failed to load the account for the Concerts view', {
					error: err,
				})
				this.isLoading = false
				this.dateGroups = []
				this.loadError = err
				return
			}
			if (signal.aborted) return
			geo = this.resolveGeoLocation()
		}
		if (!geo) {
			// No area at all (a guest or fan without a home): ask for one
			// before any location-less request.
			this.isLoading = false
			this.dateGroups = []
			this.loadError = null
			this.openAreaSelector()
			return
		}

		const key = rangeCacheKey(geo.adminArea, range.from, range.to)
		const cached = this.visit.cache.get(key)
		if (cached) {
			this.isLoading = false
			this.shownGroups = cached
			this.derive()
			this.loadError = null
			this.requestFilterMoment()
			return
		}

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
			this.requestFilterMoment()
			this.logger.info('the Concerts view loaded', {
				adminArea: geo.adminArea,
				groups: groups.length,
			})
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('Failed to load the Concerts view', { error: err })
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
	 * groups on screen, without a request, as the timetable does.
	 */
	@watch((vm: DiscoveryConcerts) => vm.followStore.hypeByArtist)
	@watch((vm: DiscoveryConcerts) => vm.journeyStore.journeyMap)
	protected onFanStateChanged(): void {
		if (this.shownGroups.length > 0) this.derive()
	}

	/**
	 * Build the cards from the groups on screen. Each card's artist comes from
	 * the concert's own performers (mostly not followed), so names render; a
	 * followed artist is matched by its hype level and lane, and a concert with
	 * a journey shows its badge, by the timetable's rules.
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
	 * A first-party concert opens its public concert page; a discovered one
	 * opens the detail sheet with the follow action.
	 */
	public onEventSelected(event: CustomEvent<{ event: Concert }>): void {
		const concert = event.detail.event
		if (concert.isFirstParty) {
			void this.router.load(`/concerts/${concert.id}`)
			return
		}
		this.detailSheet?.open(concert, 'discovery_concerts', true)
	}

	/**
	 * The list or the empty state is on screen: the first time on this device,
	 * the action menu's guide moment points at where the area and the period
	 * change (Discovery "The Concerts view's guide moment"). Opening the menu
	 * uses it (action-menu).
	 */
	private requestFilterMoment(): void {
		this.guide.request('concerts.filter')
	}

	public detaching(): void {
		this.guide.dismiss('concerts.filter', 'route_leave')
		this.abortController?.abort()
		this.abortController = null
	}
}
