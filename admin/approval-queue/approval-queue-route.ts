import type {
	ConcertCandidate,
	ExistingEvent,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/concert_candidate/v1/concert_candidate_service_pb.js'
// Import the Resolution enum value from the generated package directly (not via
// the concert-candidate-client re-export) so it survives the client module being
// mocked.
import { Resolution } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/concert_candidate/v1/concert_candidate_service_pb.js'
import { type Timestamp, timestampDate } from '@bufbuild/protobuf/wkt'
import { Code } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { sanitizeUrl } from '../../shared/utils/sanitize-url'
import { EMPTY, formatDateValue } from '../lib/local-date'
import { IAreaClient } from '../services/area-client'
import { IConcertCandidateClient } from '../services/concert-candidate-client'
import { toUserMessage } from '../services/error-message'

/** Shown for a row whose concert has no admin area. */
export const AREA_UNKNOWN = '地域不明'
/** Shown for a row whose concert has no time zone. */
export const TIME_ZONE_UNKNOWN = 'タイムゾーン不明'
/** Shown when the area the reviewer entered stands for no Area. */
export const AREA_NOT_FOUND = '地域が見つかりません'
/** Shown when Approve refuses the area or the time zone. */
export const VENUE_NOT_ACCEPTED =
	'地域またはタイムゾーンが受け付けられませんでした'

/** One entry of a row's time zone select. */
export interface ZoneOption {
	readonly value: string
	readonly label: string
}

/**
 * Where the reviewer's area input stands: empty, being resolved, resolved to a
 * first-level Area, or standing for none.
 */
export type AreaInputState = 'empty' | 'resolving' | 'resolved' | 'notFound'

/** Coarse lifecycle phase for the initial list fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

/**
 * One reviewable concert plus the per-row UI state the queue needs: whether an
 * approve/reject request is in flight (to disable the row's buttons), whether
 * the inline reject form is open, the bound reject reason, and any per-row
 * action error. The raw {@link ConcertCandidate} is kept so the template renders
 * the proto fields directly; the precomputed display strings flatten the proto
 * wrapper types so the template stays free of optional-chaining noise.
 */
export interface QueueRow {
	readonly concert: ConcertCandidate
	readonly concertCandidateId: string
	readonly performerName: string
	readonly title: string
	readonly localDate: string
	readonly startTime: string
	readonly openTime: string
	readonly listedVenueName: string
	/** The concert's admin area code; empty when it has none. */
	readonly adminArea: string
	/** The concert's IANA time zone; empty when it has none. */
	readonly timeZone: string
	/** Google Maps link to the resolved place; empty when there is none. */
	readonly resolvedPlaceUrl: string
	readonly hasResolvedPlace: boolean
	readonly sourceUrl: string
	readonly findTime: string
	/** The area the reviewer entered: a code or a name. */
	areaInput: string
	areaState: AreaInputState
	/** The time zones of the entered area's country, else the row's. */
	zoneOptions: ZoneOption[]
	/** The selected time zone; empty when none is selected. */
	zoneChoice: string
	/** Whether Approve may be pressed; recomputed on every change. */
	approvable: boolean
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

const UNKNOWN_ARTIST = 'Unknown artist'
const UNTITLED_SERIES = 'Untitled series'

function formatTimeOfDay(ts?: Timestamp): string {
	if (!ts) return EMPTY
	try {
		return timestampDate(ts).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})
	} catch {
		return EMPTY
	}
}

function formatTimestamp(ts?: Timestamp): string {
	if (!ts) return EMPTY
	try {
		return timestampDate(ts).toLocaleString()
	} catch {
		return EMPTY
	}
}

function formatLocalDate(concert: ConcertCandidate): string {
	return formatDateValue(concert.localDate?.value)
}

function formatStartTime(concert: ConcertCandidate): string {
	return formatTimeOfDay(concert.startTime?.value)
}

/**
 * Flattened display fields for the two sides of a duplicate conflict, so the
 * reconciliation dialog renders without optional-chaining noise. The candidate side
 * reuses the queue row's precomputed strings; the existing side is derived here
 * from the {@link ExistingEvent} preview the server returned.
 */
export interface ConflictView {
	readonly candidateTitle: string
	readonly candidateListedVenueName: string
	readonly candidateLocalDate: string
	readonly candidateStartTime: string
	readonly candidateOpenTime: string
	readonly existingTitle: string
	readonly existingListedVenueName: string
	readonly existingLocalDate: string
	readonly existingStartTime: string
	readonly existingOpenTime: string
}

function toConflictView(row: QueueRow, existing: ExistingEvent): ConflictView {
	return {
		candidateTitle: row.title,
		candidateListedVenueName: row.listedVenueName,
		candidateLocalDate: row.localDate,
		candidateStartTime: row.startTime,
		candidateOpenTime: row.openTime,
		existingTitle: existing.title?.value ?? EMPTY,
		existingListedVenueName: existing.listedVenueName?.value ?? EMPTY,
		existingLocalDate: formatDateValue(existing.localDate?.value),
		existingStartTime: formatTimeOfDay(existing.startTime?.value),
		existingOpenTime: formatTimeOfDay(existing.openTime?.value),
	}
}

/** Google Maps link that opens a place by its place id. */
function placeUrl(placeId: string): string {
	return `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(placeId)}`
}

function toRow(concert: ConcertCandidate): QueueRow {
	const placeId = concert.resolvedPlaceId?.value ?? ''
	const row: QueueRow = {
		concert,
		concertCandidateId: concert.id?.value ?? '',
		performerName: concert.performer?.name?.value ?? EMPTY,
		title: concert.title?.value ?? EMPTY,
		localDate: formatLocalDate(concert),
		startTime: formatStartTime(concert),
		openTime: formatTimeOfDay(concert.openTime?.value),
		listedVenueName: concert.listedVenueName?.value ?? EMPTY,
		adminArea: concert.adminArea?.value ?? '',
		timeZone: concert.timeZone?.value ?? '',
		resolvedPlaceUrl: placeId ? placeUrl(placeId) : '',
		hasResolvedPlace: placeId !== '',
		sourceUrl: concert.sourceUrl?.value ?? '',
		findTime: formatTimestamp(concert.findTime),
		areaInput: '',
		areaState: 'empty',
		zoneOptions: [],
		zoneChoice: '',
		approvable: false,
		busy: false,
		rejecting: false,
		rejectReason: '',
		actionError: '',
	}
	refreshApprovable(row)
	return row
}

/**
 * Approve needs an area (the row's, or an entered one that resolved) and a
 * time zone (the row's, or a selected one), and nothing in flight.
 */
function refreshApprovable(row: QueueRow): void {
	const hasArea =
		row.areaState === 'resolved' ||
		(row.areaState === 'empty' && row.adminArea !== '')
	const hasZone = row.timeZone !== '' || row.zoneChoice !== ''
	row.approvable = !row.busy && hasArea && hasZone
}

/**
 * Groups a flat pending-concert list into Artist → Series. Uses
 * `performer.name` as the artist key and `title.value` as the series proxy
 * (no `series.id` exists on `ConcertCandidate` until approval). First-seen order
 * is preserved; `unresolvedCount` tracks rows lacking a resolved place so the
 * collapsed summary can surface triage priority.
 */
function groupQueueByArtistAndSeries(
	concerts: ConcertCandidate[],
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
		if (!row.hasResolvedPlace) series.unresolvedCount++
	}

	return groups
}

/**
 * Concert approval-queue screen. Loads the pending queue on attach and lets a
 * reviewer approve or reject each discovered concert, grouped by artist then
 * series title. Approve/reject run against the admin-local
 * {@link IConcertCandidateClient}; on success the row is removed and empty
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

	private readonly client = resolve(IConcertCandidateClient)
	private readonly areaClient = resolve(IAreaClient)
	private readonly logger = resolve(ILogger).scopeTo('ApprovalQueueRoute')

	/**
	 * Allowlists a source URL to http(s) before it is bound to an anchor
	 * `href`. The source URL is AI-discovered, so a `javascript:` value must be
	 * neutralised — Aurelia does not sanitize attribute bindings. Exposed for
	 * the template binding `href.bind="sanitizeUrl(row.sourceUrl)"`.
	 */
	public readonly sanitizeUrl = sanitizeUrl

	public readonly areaUnknown = AREA_UNKNOWN
	public readonly timeZoneUnknown = TIME_ZONE_UNKNOWN
	public readonly areaNotFound = AREA_NOT_FOUND

	public async attached(): Promise<void> {
		await this.load()
	}

	public async load(): Promise<void> {
		this.phase = 'loading'
		this.loadError = ''
		try {
			const pending = await this.client.list()
			this.groups = groupQueueByArtistAndSeries(pending)
			this.phase = 'ready'
			for (const group of this.groups) {
				for (const series of group.series) {
					for (const row of series.rows) void this.showRowZones(row)
				}
			}
		} catch (err) {
			this.loadError = toUserMessage(err, 'Failed to load the approval queue.')
			this.phase = 'error'
			this.logger.error('Failed to load pending concerts', err)
		}
	}

	public async approve(
		group: PendingArtistGroup,
		series: PendingSeriesGroup,
		row: QueueRow,
	): Promise<void> {
		if (row.busy || !row.approvable) return
		row.busy = true
		refreshApprovable(row)
		row.actionError = ''
		try {
			const response = await this.client.approve(
				row.concertCandidateId,
				Resolution.UNSPECIFIED,
				venueOf(row),
			)
			// A duplicate existing event was detected: the server mutated nothing and
			// returned both records. Prompt the reviewer to reconcile instead of
			// silently dropping or dead-ending.
			if (response.conflict?.existing) {
				this.activeConflict = { group, series, row }
				this.conflictView = toConflictView(row, response.conflict.existing)
				this.conflictError = ''
				row.busy = false
				refreshApprovable(row)
				// Optional-call guards the jsdom test environment, which does not
				// implement HTMLDialogElement.showModal.
				this.conflictDialog?.showModal?.()
				return
			}
			this.removeRow(group, series, row)
		} catch (err) {
			row.actionError = toUserMessage(err, 'Approval failed. Try again.', {
				[Code.InvalidArgument]: VENUE_NOT_ACCEPTED,
			})
			row.busy = false
			refreshApprovable(row)
			this.logger.error('Approve failed', {
				concertCandidateId: row.concertCandidateId,
				err,
			})
		}
	}

	/** Reviewer chose to keep the existing event; the concert candidate is logged + cleared. */
	public async keepExisting(): Promise<void> {
		await this.resolveConflict(Resolution.KEEP_EXISTING)
	}

	/**
	 * Reviewer chose to adopt the concert candidate's display fields onto the
	 * existing event (`Resolution.ADOPT_CANDIDATE`).
	 */
	public async adoptCandidate(): Promise<void> {
		await this.resolveConflict(Resolution.ADOPT_CANDIDATE)
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
			// server re-reads the concert candidate and is idempotent if it is already gone.
			await this.client.approve(
				active.row.concertCandidateId,
				resolution,
				venueOf(active.row),
			)
			this.removeRow(active.group, active.series, active.row)
			this.closeConflict()
		} catch (err) {
			this.conflictError = toUserMessage(
				err,
				'Reconciliation failed. Try again.',
			)
			this.logger.error('Conflict resolution failed', {
				concertCandidateId: active.row.concertCandidateId,
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

	/**
	 * The reviewer changed a row's area input: resolve it through the admin
	 * AreaService and list its country's time zones, or say it was not found.
	 * An emptied input goes back to the row's own area.
	 */
	public async areaChanged(row: QueueRow): Promise<void> {
		const text = row.areaInput.trim()
		row.actionError = ''
		if (text === '') {
			row.areaState = 'empty'
			await this.showRowZones(row)
			return
		}
		row.areaState = 'resolving'
		refreshApprovable(row)
		try {
			const area = await this.areaClient.resolve(text)
			// A newer input replaced this one while it was resolving.
			if (row.areaInput.trim() !== text) return
			if (!area) {
				row.areaState = 'notFound'
				row.zoneOptions = []
				row.zoneChoice = ''
				refreshApprovable(row)
				return
			}
			row.areaState = 'resolved'
			await this.showZones(
				row,
				area.countryCode?.value ?? '',
				area.code?.value ?? '',
			)
		} catch (err) {
			row.areaState = 'empty'
			row.actionError = toUserMessage(
				err,
				'Could not check the area. Try again.',
			)
			refreshApprovable(row)
			this.logger.error('Area resolve failed', { text, err })
		}
	}

	/**
	 * The reviewer chose a time zone. Each option binds its own `selected`
	 * instead of the select's value: a select bound to a value that its
	 * options do not list yet shows nothing, and a two-way one writes that
	 * empty value back, dropping the zone this screen preselected.
	 */
	public zoneChanged(row: QueueRow, zone: string): void {
		row.zoneChoice = zone
		refreshApprovable(row)
	}

	/** Lists the time zones of the row's own area's country, if it has one. */
	private async showRowZones(row: QueueRow): Promise<void> {
		if (row.adminArea === '') {
			row.zoneOptions = []
			row.zoneChoice = ''
			refreshApprovable(row)
			return
		}
		await this.showZones(row, row.adminArea.slice(0, 2), row.adminArea)
	}

	/**
	 * Lists a country's time zones in the row's select. The area's own zone is
	 * selected when it has one; otherwise a choice still in the list is kept,
	 * else the row's zone when listed, else none.
	 */
	private async showZones(
		row: QueueRow,
		countryCode: string,
		areaCode: string,
	): Promise<void> {
		try {
			const country = await this.areaClient.listByCountry(countryCode)
			row.zoneOptions = country.timeZones.map((z) => ({
				value: z.timeZone?.value ?? '',
				label: z.nameJa ?? z.nameEn,
			}))
			const listed = (zone: string) =>
				zone !== '' && row.zoneOptions.some((o) => o.value === zone)
			const own = country.areas.find((a) => a.code?.value === areaCode)
				?.timeZone?.value
			if (own && listed(own)) row.zoneChoice = own
			else if (!listed(row.zoneChoice))
				row.zoneChoice = listed(row.timeZone) ? row.timeZone : ''
		} catch (err) {
			row.zoneOptions = []
			row.actionError = toUserMessage(
				err,
				'Could not load the time zones. Try again.',
			)
			this.logger.error('Time zone list failed', { countryCode, err })
		}
		refreshApprovable(row)
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
			await this.client.reject(row.concertCandidateId, reason)
			this.removeRow(group, series, row)
		} catch (err) {
			row.actionError = toUserMessage(err, 'Rejection failed. Try again.')
			row.busy = false
			this.logger.error('Reject failed', {
				concertCandidateId: row.concertCandidateId,
				err,
			})
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
		if (!row.hasResolvedPlace) series.unresolvedCount--
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

/** The area text and time zone a row's Approve sends, each when given. */
function venueOf(row: QueueRow): { adminArea?: string; timeZone?: string } {
	const adminArea = row.areaInput.trim()
	return {
		adminArea: adminArea === '' ? undefined : adminArea,
		timeZone: row.zoneChoice === '' ? undefined : row.zoneChoice,
	}
}
