import type { PendingConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_service_pb.js'
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

const EMPTY = '—'

function formatLocalDate(concert: PendingConcert): string {
	const d = concert.localDate?.value
	if (!d) return EMPTY
	// google.type.Date is a plain Y/M/D triple (no timezone). Pad to ISO-ish
	// YYYY-MM-DD so review rows sort/read consistently regardless of locale.
	const mm = String(d.month).padStart(2, '0')
	const dd = String(d.day).padStart(2, '0')
	return `${d.year}-${mm}-${dd}`
}

function formatTimestamp(ts?: { toDate(): Date }): string {
	if (!ts) return EMPTY
	try {
		return ts.toDate().toLocaleString()
	} catch {
		return EMPTY
	}
}

function formatStartTime(concert: PendingConcert): string {
	const ts = concert.startTime?.value
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

function toRow(concert: PendingConcert): QueueRow {
	const resolved = concert.resolvedVenue
	return {
		concert,
		stagedId: concert.stagedId?.value ?? '',
		performerName: concert.performer?.name?.value ?? EMPTY,
		title: concert.title?.value ?? EMPTY,
		localDate: formatLocalDate(concert),
		startTime: formatStartTime(concert),
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
 * Concert approval-queue screen. Loads the pending queue on attach and lets a
 * reviewer approve or reject each discovered concert. Approve/reject run
 * against the admin-local {@link IConcertClient}; on success the row
 * is removed from the list, on failure a per-row error is surfaced and the row
 * stays put so the action can be retried.
 */
export class ApprovalQueueRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public rows: QueueRow[] = []

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
			this.rows = pending.map(toRow)
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

	public async approve(row: QueueRow): Promise<void> {
		if (row.busy) return
		row.busy = true
		row.actionError = ''
		try {
			await this.client.approve(row.stagedId)
			this.removeRow(row)
		} catch (err) {
			row.actionError =
				err instanceof Error ? err.message : 'Approval failed. Try again.'
			row.busy = false
			this.logger.error('Approve failed', { stagedId: row.stagedId, err })
		}
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

	public async confirmReject(row: QueueRow): Promise<void> {
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
			this.removeRow(row)
		} catch (err) {
			row.actionError =
				err instanceof Error ? err.message : 'Rejection failed. Try again.'
			row.busy = false
			this.logger.error('Reject failed', { stagedId: row.stagedId, err })
		}
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.rows.length === 0
	}

	private removeRow(row: QueueRow): void {
		const idx = this.rows.indexOf(row)
		if (idx !== -1) this.rows.splice(idx, 1)
	}
}
