import type {
	ExistingEvent,
	PendingConcert,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_service_pb.js'
// Import the Resolution enum value from the generated package directly (not via
// the concert-client re-export) so it survives the client module being mocked.
import { Resolution } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_service_pb.js'
import { ILogger, resolve } from 'aurelia'
import { sanitizeUrl } from '../../shared/utils/sanitize-url'
import { IConcertClient } from '../services/concert-client'

/** Coarse lifecycle phase for the initial list fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

/**
 * One reviewable concert plus the per-row UI state the queue needs: whether an
 * approve/reject request is in flight (to disable the row's buttons), whether
 * the inline reject form is open, the bound reject reason, and any per-row
 * action error. The raw {@link PendingConcert} is kept so the template renders
 * the proto fields directly; the precomputed display strings flatten the proto
 * wrapper types so the template stays free of optional-chaining noise.
 */
export interface QueueRow {
	readonly concert: PendingConcert
	readonly stagedId: string
	readonly performerName: string
	readonly title: string
	readonly localDate: string
	readonly startTime: string
	readonly openTime: string
	readonly listedVenueName: string
	readonly resolvedVenueName: string
	readonly resolvedAdminArea: string
	readonly hasResolvedVenue: boolean
	readonly sourceUrl: string
	readonly discoveredTime: string
	busy: boolean
	rejecting: boolean
	rejectReason: string
	actionError: string
}

/** All pending concerts for one tour/show title within one artist bucket. */
export interface PendingSeriesGroup {
	readonly seriesTitle: string
	rows: QueueRow[]
	unresolvedCount: number
}

/** All series grouped under a single performing artist. */
export interface PendingArtistGroup {
	readonly artistName: string
	series: PendingSeriesGroup[]
}

const EMPTY = '—'
const UNKNOWN_ARTIST = 'Unknown artist'
const UNTITLED_SERIES = 'Untitled series'

function formatDateValue(d?: {
	year: number
	month: number
	day: number
}): string {
	if (!d) return EMPTY
	// google.type.Date is a plain Y/M/D triple (no timezone). Pad to ISO-ish
	// YYYY-MM-DD so review rows sort/read consistently regardless of locale.
	const mm = String(d.month).padStart(2, '0')
	const dd = String(d.day).padStart(2, '0')
	return `${d.year}-${mm}-${dd}`
}

function formatTimeOfDay(ts?: { toDate(): Date }): string {
	if (!ts) return EMPTY
	try {
		return ts.toDate().toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return EMPTY
	}
}

function formatTimestamp(ts?: { toDate(): Date }): string {
	if (!ts) return EMPTY
	try {
		return ts.toDate().toLocaleString()
	} catch {
		return EMPTY
	}
}

function formatLocalDate(concert: PendingConcert): string {
	return formatDateValue(concert.localDate?.value)
}

function formatStartTime(concert: PendingConcert): string {
	return formatTimeOfDay(concert.startTime?.value)
}

/**
 * Flattened display fields for the two sides of a duplicate conflict, so the
 * reconciliation dialog renders without optional-chaining noise. The staged side
 * reuses the queue row's precomputed strings; the existing side is derived here
 * from the {@link ExistingEvent} preview the server returned.
 */
export interface ConflictView {
	readonly stagedTitle: string
	readonly stagedListedVenueName: string
	readonly stagedLocalDate: string
	readonly stagedStartTime: string
	readonly stagedOpenTime: string
	readonly existingTitle: string
	readonly existingListedVenueName: string
	readonly existingLocalDate: string
	readonly existingStartTime: string
	readonly existingOpenTime: string
}

function toConflictView(row: QueueRow, existing: ExistingEvent): ConflictView {
	return {
		stagedTitle: row.title,
		stagedListedVenueName: row.listedVenueName,
		stagedLocalDate: row.localDate,
		stagedStartTime: row.startTime,
		stagedOpenTime: row.openTime,
		existingTitle: existing.title?.value ?? EMPTY,
		existingListedVenueName: existing.listedVenueName?.value ?? EMPTY,
		existingLocalDate: formatDateValue(existing.localDate?.value),
		existingStartTime: formatTimeOfDay(existing.startTime?.value),
		existingOpenTime: formatTimeOfDay(existing.openTime?.value),
	}
}

function toRow(concert: PendingConcert): QueueRow {
	const resolved = concert.resolvedVenue
	return {
		concert,
		stagedId: concert.stagedId?.value ?? '',
		performerName: concert.performer?.name?.value ?? EMPTY,
		title: concert.title?.value ?? EMPTY,
		localDate: formatLocalDate(concert),
		startTime: formatStartTime(concert),
		openTime: formatTimeOfDay(concert.openTime?.value),
		listedVenueName: concert.listedVenueName?.value ?? EMPTY,
		resolvedVenueName: resolved?.name?.value ?? EMPTY,
		resolvedAdminArea: resolved?.adminArea?.value ?? EMPTY,
		hasResolvedVenue: resolved !== undefined,
		sourceUrl: concert.sourceUrl?.value ?? '',
		discoveredTime: formatTimestamp(concert.discoveredTime),
		busy: false,
		rejecting: false,
		rejectReason: '',
		actionError: '',
	}
}

/**
 * Groups a flat pending-concert list into Artist → Series. Uses
 * `performer.name` as the artist key and `title.value` as the series proxy
 * (no `series.id` exists on `PendingConcert` until approval). First-seen order
 * is preserved; `unresolvedCount` tracks rows lacking a resolved venue so the
 * collapsed summary can surface triage priority.
 */
function groupQueueByArtistAndSeries(
	concerts: PendingConcert[],
): PendingArtistGroup[] {
	const groups: PendingArtistGroup[] = []
	const artistByName = new Map<string, PendingArtistGroup>()
	const seriesByKey = new Map<string, PendingSeriesGroup>()

	for (const concert of concerts) {
		const artistName = concert.performer?.name?.value ?? UNKNOWN_ARTIST
		let artist = artistByName.get(artistName)
		if (!artist) {
			artist = { artistName, series: [] }
			artistByName.set(artistName, artist)
			groups.push(artist)
		}

		const seriesTitle = concert.title?.value ?? UNTITLED_SERIES
		// Null byte separator prevents "A\0B" vs "AB\0" key collisions.
		const seriesKey = `${artistName}\0${seriesTitle}`
		let series = seriesByKey.get(seriesKey)
		if (!series) {
			series = { seriesTitle, rows: [], unresolvedCount: 0 }
			seriesByKey.set(seriesKey, series)
			artist.series.push(series)
		}

		const row = toRow(concert)
		series.rows.push(row)
		if (!row.hasResolvedVenue) series.unresolvedCount++
	}

	return groups
}

/**
 * Concert approval-queue screen. Loads the pending queue on attach and lets a
 * reviewer approve or reject each discovered concert, grouped by artist then
 * series title. Approve/reject run against the admin-local
 * {@link IConcertClient}; on success the row is removed and empty
 * series/artist headings are pruned, on failure a per-row error is surfaced
 * and the row stays put so the action can be retried.
 */
export class ApprovalQueueRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public groups: PendingArtistGroup[] = []

	/**
	 * The duplicate-conflict currently being reconciled, or null when the dialog
	 * is closed. Holds the queue location so the row can be pruned once the
	 * reviewer picks a resolution.
	 */
	public conflictView: ConflictView | null = null
	public conflictBusy = false
	public conflictError = ''

	/** Bound via ref; the native <dialog> reused for every reconciliation. */
	public conflictDialog?: HTMLDialogElement

	private activeConflict: {
		group: PendingArtistGroup
		series: PendingSeriesGroup
		row: QueueRow
	} | null = null

	private readonly client = resolve(IConcertClient)
	private readonly logger = resolve(ILogger).scopeTo('ApprovalQueueRoute')

	/**
	 * Allowlists a source URL to http(s) before it is bound to an anchor
	 * `href`. The source URL is AI-discovered, so a `javascript:` value must be
	 * neutralised — Aurelia does not sanitize attribute bindings. Exposed for
	 * the template binding `href.bind="sanitizeUrl(row.sourceUrl)"`.
	 */
	public readonly sanitizeUrl = sanitizeUrl

	public async attached(): Promise<void> {
		await this.load()
	}

	public async load(): Promise<void> {
		this.phase = 'loading'
		this.loadError = ''
		try {
			const pending = await this.client.listPending()
			this.groups = groupQueueByArtistAndSeries(pending)
			this.phase = 'ready'
		} catch (err) {
			this.loadError =
				err instanceof Error
					? err.message
					: 'Failed to load the approval queue.'
			this.phase = 'error'
			this.logger.error('Failed to load pending concerts', err)
		}
	}

	public async approve(
		group: PendingArtistGroup,
		series: PendingSeriesGroup,
		row: QueueRow,
	): Promise<void> {
		if (row.busy) return
		row.busy = true
		row.actionError = ''
		try {
			const response = await this.client.approve(
				row.stagedId,
				Resolution.UNSPECIFIED,
			)
			// A duplicate existing event was detected: the server mutated nothing and
			// returned both records. Prompt the reviewer to reconcile instead of
			// silently dropping or dead-ending.
			if (response.conflict?.existing) {
				this.activeConflict = { group, series, row }
				this.conflictView = toConflictView(row, response.conflict.existing)
				this.conflictError = ''
				row.busy = false
				// Optional-call guards the jsdom test environment, which does not
				// implement HTMLDialogElement.showModal.
				this.conflictDialog?.showModal?.()
				return
			}
			this.removeRow(group, series, row)
		} catch (err) {
			row.actionError =
				err instanceof Error ? err.message : 'Approval failed. Try again.'
			row.busy = false
			this.logger.error('Approve failed', { stagedId: row.stagedId, err })
		}
	}

	/** Reviewer chose to keep the existing event; the staged row is logged + cleared. */
	public async keepExisting(): Promise<void> {
		await this.resolveConflict(Resolution.KEEP_EXISTING)
	}

	/** Reviewer chose to adopt the staged row's display fields onto the existing event. */
	public async adoptStaged(): Promise<void> {
		await this.resolveConflict(Resolution.ADOPT_STAGED)
	}

	/** Dismisses the conflict dialog without resolving; the row stays in the queue. */
	public cancelConflict(): void {
		this.closeConflict()
	}

	private async resolveConflict(resolution: Resolution): Promise<void> {
		const active = this.activeConflict
		if (!active || this.conflictBusy) return
		this.conflictBusy = true
		this.conflictError = ''
		try {
			// The second phase re-calls Approve with the chosen resolution; the
			// server re-reads the staged row and is idempotent if it is already gone.
			await this.client.approve(active.row.stagedId, resolution)
			this.removeRow(active.group, active.series, active.row)
			this.closeConflict()
		} catch (err) {
			this.conflictError =
				err instanceof Error ? err.message : 'Reconciliation failed. Try again.'
			this.logger.error('Conflict resolution failed', {
				stagedId: active.row.stagedId,
				resolution,
				err,
			})
		} finally {
			this.conflictBusy = false
		}
	}

	private closeConflict(): void {
		this.conflictDialog?.close?.()
		this.activeConflict = null
		this.conflictView = null
		this.conflictError = ''
	}

	/** Opens the inline reject form for a row. */
	public startReject(row: QueueRow): void {
		row.rejecting = true
		row.actionError = ''
	}

	/** Cancels the inline reject form without dropping the concert. */
	public cancelReject(row: QueueRow): void {
		row.rejecting = false
		row.rejectReason = ''
	}

	public async confirmReject(
		group: PendingArtistGroup,
		series: PendingSeriesGroup,
		row: QueueRow,
	): Promise<void> {
		if (row.busy) return
		const reason = row.rejectReason.trim()
		if (reason.length === 0) {
			row.actionError = 'A rejection reason is required.'
			return
		}
		row.busy = true
		row.actionError = ''
		try {
			await this.client.reject(row.stagedId, reason)
			this.removeRow(group, series, row)
		} catch (err) {
			row.actionError =
				err instanceof Error ? err.message : 'Rejection failed. Try again.'
			row.busy = false
			this.logger.error('Reject failed', { stagedId: row.stagedId, err })
		}
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.groups.length === 0
	}

	private removeRow(
		group: PendingArtistGroup,
		series: PendingSeriesGroup,
		row: QueueRow,
	): void {
		if (!row.hasResolvedVenue) series.unresolvedCount--
		const rowIdx = series.rows.indexOf(row)
		if (rowIdx !== -1) series.rows.splice(rowIdx, 1)
		// Drop the series heading once its last concert is gone...
		if (series.rows.length === 0) {
			const sIdx = group.series.indexOf(series)
			if (sIdx !== -1) group.series.splice(sIdx, 1)
		}
		// ...and the artist heading once its last series is gone.
		if (group.series.length === 0) {
			const gIdx = this.groups.indexOf(group)
			if (gIdx !== -1) this.groups.splice(gIdx, 1)
		}
	}
}
