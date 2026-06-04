import { bindable, observable } from 'aurelia'
import type { CountedArtist } from '../../entities/artist'
import type { JourneyStatus } from '../../entities/concert'
import {
	JOURNEY_STATUS_CONFIG,
	type JourneyStatusConfig,
	journeyOutcome,
} from '../../entities/ticket-journey'

export class ArtistFilterBar {
	/** Followed artists with upcoming-concert counts (already sorted, zero hidden). */
	@bindable public countedArtists: CountedArtist[] = []
	@bindable({ mode: 'twoWay' }) public selectedIds: string[] = []
	@bindable({ mode: 'twoWay' }) public selectedStatuses: JourneyStatus[] = []
	/** Drives journey-facet visibility; the artist facet is always present. */
	@bindable public isAuthenticated = false

	public isSheetOpen = false

	/** Pending selections inside the bottom sheet (committed on confirm). */
	@observable public pendingIds: string[] = []
	@observable public pendingStatuses: JourneyStatus[] = []

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

	public get hasPendingSelection(): boolean {
		return this.pendingIds.length > 0 || this.pendingStatuses.length > 0
	}

	public openSheet(): void {
		this.pendingIds = [...this.selectedIds]
		this.pendingStatuses = [...this.selectedStatuses]
		this.isSheetOpen = true
	}

	public closeSheet(): void {
		this.isSheetOpen = false
	}

	public clearAll(): void {
		this.pendingIds = []
		this.pendingStatuses = []
	}

	public confirmSelection(): void {
		this.selectedIds = [...this.pendingIds]
		this.selectedStatuses = [...this.pendingStatuses]
		this.isSheetOpen = false
	}
}
