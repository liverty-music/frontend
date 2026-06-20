import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { ILogger, resolve } from 'aurelia'
import { IConcertClient } from '../services/concert-client'

/** Coarse lifecycle phase for the initial list fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

/**
 * One published concert plus the per-row UI state the screen needs: whether a
 * delete request is in flight (to disable the row's controls), whether the
 * inline delete confirmation is open, and any per-row action error. The display
 * strings flatten the proto wrapper types so the template stays free of
 * optional-chaining noise.
 */
export interface ConcertRow {
	readonly eventId: string
	readonly title: string
	readonly localDate: string
	readonly venueName: string
	busy: boolean
	confirming: boolean
	actionError: string
}

/** Published concerts grouped under a single performing artist. */
export interface ArtistGroup {
	readonly artistName: string
	rows: ConcertRow[]
}

const EMPTY = '—'
const UNKNOWN_ARTIST = 'Unknown artist'

function formatLocalDate(concert: Concert): string {
	const d = concert.localDate?.value
	if (!d) return EMPTY
	// entity LocalDate wraps a google.type.Date (plain Y/M/D triple, no
	// timezone). Pad to ISO-ish YYYY-MM-DD so rows sort/read consistently.
	const mm = String(d.month).padStart(2, '0')
	const dd = String(d.day).padStart(2, '0')
	return `${d.year}-${mm}-${dd}`
}

function toRow(concert: Concert): ConcertRow {
	return {
		eventId: concert.id?.value ?? '',
		title: concert.series?.title?.value ?? EMPTY,
		localDate: formatLocalDate(concert),
		venueName: concert.venue?.name?.value ?? EMPTY,
		busy: false,
		confirming: false,
		actionError: '',
	}
}

/**
 * Groups the flat published-concert list by the first-billed performing artist.
 * A concert with multiple performers (festival/co-headliner) is filed under its
 * lead performer; concerts with no resolvable performer fall under a single
 * "Unknown artist" bucket. Groups preserve first-seen order, which mirrors the
 * server's catalog ordering (by local date).
 */
function groupByArtist(concerts: Concert[]): ArtistGroup[] {
	const groups: ArtistGroup[] = []
	const byName = new Map<string, ArtistGroup>()
	for (const concert of concerts) {
		const artistName = concert.performers?.[0]?.name?.value ?? UNKNOWN_ARTIST
		let group = byName.get(artistName)
		if (!group) {
			group = { artistName, rows: [] }
			byName.set(artistName, group)
			groups.push(group)
		}
		group.rows.push(toRow(concert))
	}
	return groups
}

/**
 * Approved-concerts screen. Loads the full published catalog on attach and
 * presents it grouped by performing artist. Each row offers a confirm-gated
 * manual delete that runs against the admin-local {@link IConcertClient}; on
 * success the row is removed (and the group dropped when it empties), on failure
 * a per-row error is surfaced and the row stays put so the action can be retried.
 */
export class ApprovedConcertsRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public groups: ArtistGroup[] = []

	private readonly client = resolve(IConcertClient)
	private readonly logger = resolve(ILogger).scopeTo('ApprovedConcertsRoute')

	public async attached(): Promise<void> {
		await this.load()
	}

	public async load(): Promise<void> {
		this.phase = 'loading'
		this.loadError = ''
		try {
			const concerts = await this.client.list()
			this.groups = groupByArtist(concerts)
			this.phase = 'ready'
		} catch (err) {
			this.loadError =
				err instanceof Error
					? err.message
					: 'Failed to load published concerts.'
			this.phase = 'error'
			this.logger.error('Failed to load approved concerts', err)
		}
	}

	/** Opens the inline delete confirmation for a row. */
	public startDelete(row: ConcertRow): void {
		row.confirming = true
		row.actionError = ''
	}

	/** Cancels the inline delete confirmation without deleting. */
	public cancelDelete(row: ConcertRow): void {
		row.confirming = false
	}

	public async confirmDelete(
		group: ArtistGroup,
		row: ConcertRow,
	): Promise<void> {
		if (row.busy) return
		row.busy = true
		row.actionError = ''
		try {
			await this.client.delete(row.eventId)
			this.removeRow(group, row)
		} catch (err) {
			row.actionError =
				err instanceof Error ? err.message : 'Delete failed. Try again.'
			row.busy = false
			this.logger.error('Delete failed', { eventId: row.eventId, err })
		}
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.groups.length === 0
	}

	private removeRow(group: ArtistGroup, row: ConcertRow): void {
		const idx = group.rows.indexOf(row)
		if (idx !== -1) group.rows.splice(idx, 1)
		// Drop the artist heading once its last concert is gone.
		if (group.rows.length === 0) {
			const gIdx = this.groups.indexOf(group)
			if (gIdx !== -1) this.groups.splice(gIdx, 1)
		}
	}
}
