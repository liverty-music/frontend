import { bindable, INode, observable, resolve } from 'aurelia'
import type { CalendarDate } from '../../adapter/rpc/client/concert-client'
import type { CountedArtist } from '../../entities/artist'
import type { JourneyStatus } from '../../entities/concert'
import {
	JOURNEY_STATUS_CONFIG,
	type JourneyStatusConfig,
	journeyOutcome,
} from '../../entities/ticket-journey'
import {
	formatDateInput,
	isValidCalendarDate,
	parseDateInput,
	todayCalendarDate,
} from '../../lib/plain-date'

export class ArtistFilterBar {
	/** Followed artists with upcoming-concert counts (already sorted, zero hidden). */
	@bindable public countedArtists: CountedArtist[] = []
	@bindable({ mode: 'twoWay' }) public selectedIds: string[] = []
	@bindable({ mode: 'twoWay' }) public selectedStatuses: JourneyStatus[] = []
	/** Drives journey-facet visibility; the artist facet is always present. */
	@bindable public isAuthenticated = false
	/**
	 * The active date lower bound (today onward by default). Seeds the date field
	 * when the sheet opens. A change is committed by dispatching `date-changed`
	 * on confirm rather than two-way binding, because the parent re-fetches on it.
	 */
	@bindable public activeFrom: CalendarDate = todayCalendarDate()

	private readonly element = resolve(INode) as HTMLElement

	public isSheetOpen = false
	/** Whether the collapsible "過去のコンサートも表示" date facet is expanded. */
	public isDateFacetExpanded = false

	/** Pending selections inside the bottom sheet (committed on confirm). */
	@observable public pendingIds: string[] = []
	@observable public pendingStatuses: JourneyStatus[] = []
	/** Pending `from` date as a `YYYY-MM-DD` string (bound to the date input). */
	@observable public pendingFrom = ''

	/**
	 * Journey chips split into the two journey-flow phases, so the template can
	 * render a process row (tracking, applied) and an outcome row (unpaid, paid,
	 * lost) with a visual break between them. Derived from the canonical map via
	 * the existing outcome classifier — no inline ordering.
	 */
	public readonly processStatuses: readonly JourneyStatusConfig[] =
		JOURNEY_STATUS_CONFIG.filter((c) => journeyOutcome(c.status) === 'pending')
	public readonly outcomeStatuses: readonly JourneyStatusConfig[] =
		JOURNEY_STATUS_CONFIG.filter((c) => journeyOutcome(c.status) !== 'pending')

	/** Journey facet is gated to authenticated users (absent from the DOM otherwise). */
	public get showJourneyFacet(): boolean {
		return this.isAuthenticated
	}

	/** True when any facet (artist, journey, or a non-default date) is pending. */
	public get hasPendingSelection(): boolean {
		return (
			this.pendingIds.length > 0 ||
			this.pendingStatuses.length > 0 ||
			!this.isPendingFromDefault()
		)
	}

	/** True when any facet is committed — drives the trigger's active indicator. */
	public get isFilterActive(): boolean {
		return (
			this.selectedIds.length > 0 ||
			this.selectedStatuses.length > 0 ||
			!sameCalendarDate(this.activeFrom, todayCalendarDate())
		)
	}

	public openSheet(): void {
		this.pendingIds = [...this.selectedIds]
		this.pendingStatuses = [...this.selectedStatuses]
		this.pendingFrom = formatDateInput(this.activeFrom)
		// Reveal the date facet when a non-default (past/future) date is active, so
		// the user immediately sees the value that is widening their timetable.
		this.isDateFacetExpanded = !sameCalendarDate(
			this.activeFrom,
			todayCalendarDate(),
		)
		this.isSheetOpen = true
	}

	public closeSheet(): void {
		this.isSheetOpen = false
	}

	/** Toggle the collapsible date facet ("過去のコンサートも表示"). */
	public toggleDateFacet(): void {
		this.isDateFacetExpanded = !this.isDateFacetExpanded
	}

	public clearAll(): void {
		this.pendingIds = []
		this.pendingStatuses = []
		// Reset the date facet to the today-onward default and collapse it.
		this.pendingFrom = formatDateInput(todayCalendarDate())
		this.isDateFacetExpanded = false
	}

	public confirmSelection(): void {
		this.selectedIds = [...this.pendingIds]
		this.selectedStatuses = [...this.pendingStatuses]

		// The date facet re-fetches, so commit it via an event (not two-way binding)
		// and only when it actually changed. A missing/malformed input falls back to
		// today (the default), which also clears any active past window.
		const parsed = parseDateInput(this.pendingFrom)
		const nextFrom =
			parsed && isValidCalendarDate(parsed) ? parsed : todayCalendarDate()
		if (!sameCalendarDate(nextFrom, this.activeFrom)) {
			this.element.dispatchEvent(
				new CustomEvent<CalendarDate>('date-changed', {
					detail: nextFrom,
					bubbles: true,
				}),
			)
		}

		this.isSheetOpen = false
	}

	private isPendingFromDefault(): boolean {
		const parsed = parseDateInput(this.pendingFrom)
		if (!parsed) return true
		return sameCalendarDate(parsed, todayCalendarDate())
	}
}

/** Structural equality for two calendar dates (year/month/day). */
function sameCalendarDate(a: CalendarDate, b: CalendarDate): boolean {
	return a.year === b.year && a.month === b.month && a.day === b.day
}
