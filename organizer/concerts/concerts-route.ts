import {
	PublishState,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { ILogger, resolve } from 'aurelia'
import {
	type AuthoredConcert,
	IConcertAuthoringClient,
} from '../services/concert-authoring-client'
import { Code, toOrganizerErrorMessage } from '../services/connect-error-copy'

/** Coarse lifecycle phase for the initial list fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

const EMPTY = '—'
const UNTITLED = 'Untitled'

/**
 * A flattened dashboard row for one authored concert (one series). Display
 * strings flatten the proto wrapper types so the template stays free of
 * optional-chaining noise; raw state enums drive the action affordances.
 */
export interface ConcertListRow {
	readonly seriesId: string
	readonly title: string
	readonly dateRange: string
	readonly publishState: PublishState
	readonly publishLabel: string
	readonly visibility: Visibility
	readonly visibilityLabel: string
	readonly canEdit: boolean
	readonly canPublish: boolean
	readonly canCancel: boolean
	/**
	 * Per-event entry points to lottery-phase configuration. Non-empty only for
	 * a `PUBLISHED` series — a lottery phase requires a published event. Each
	 * entry carries the `eventId` so the console deep-links to
	 * `lottery/configure/:eventId` without the Organizer knowing the id.
	 */
	readonly lotteryEvents: readonly {
		readonly eventId: string
		readonly label: string
	}[]
	/** True while a publish/cancel action for this row is in flight. */
	busy: boolean
	actionError: string
}

const PUBLISH_LABELS: Record<PublishState, string> = {
	[PublishState.UNSPECIFIED]: EMPTY,
	[PublishState.DRAFT]: 'Draft',
	[PublishState.PUBLISHED]: 'Published',
	[PublishState.CANCELLED]: 'Cancelled',
}

const VISIBILITY_LABELS: Record<Visibility, string> = {
	[Visibility.UNSPECIFIED]: EMPTY,
	[Visibility.PUBLIC]: 'Public',
	[Visibility.UNLISTED]: 'Unlisted',
}

/** Formats an event's local date triple as `YYYY-MM-DD`, or `—`. */
function formatEventDate(concert: AuthoredConcert, index: number): string {
	const d = concert.events[index]?.localDate?.value
	if (!d) return EMPTY
	const mm = String(d.month).padStart(2, '0')
	const dd = String(d.day).padStart(2, '0')
	return `${d.year}-${mm}-${dd}`
}

/** Summarises a series' events as a single date or a `first – last` range. */
function formatDateRange(concert: AuthoredConcert): string {
	if (concert.events.length === 0) return EMPTY
	const first = formatEventDate(concert, 0)
	if (concert.events.length === 1) return first
	const last = formatEventDate(concert, concert.events.length - 1)
	return `${first} – ${last}`
}

/**
 * Builds the per-event lottery entry points for a published series. Empty for
 * any non-published series (a lottery phase requires a published event) and for
 * events lacking an id. When a series has several events the label carries the
 * event date so each link is distinguishable.
 */
function toLotteryEvents(
	concert: AuthoredConcert,
	publishState: PublishState,
): ConcertListRow['lotteryEvents'] {
	if (publishState !== PublishState.PUBLISHED) return []
	const multi = concert.events.length > 1
	return concert.events
		.map((event, index) => ({
			eventId: event.id?.value ?? '',
			label: multi
				? `Configure lottery · ${formatEventDate(concert, index)}`
				: 'Configure lottery',
		}))
		.filter((entry) => entry.eventId !== '')
}

function toRow(concert: AuthoredConcert): ConcertListRow {
	const series = concert.series
	const publishState = series?.publishState ?? PublishState.UNSPECIFIED
	const visibility = series?.visibility ?? Visibility.UNSPECIFIED
	return {
		seriesId: series?.id?.value ?? '',
		title: series?.title?.value || UNTITLED,
		dateRange: formatDateRange(concert),
		publishState,
		publishLabel: PUBLISH_LABELS[publishState],
		visibility,
		visibilityLabel: VISIBILITY_LABELS[visibility],
		canEdit: publishState !== PublishState.CANCELLED,
		canPublish: publishState === PublishState.DRAFT,
		canCancel: publishState !== PublishState.CANCELLED,
		lotteryEvents: toLotteryEvents(concert, publishState),
		busy: false,
		actionError: '',
	}
}

/**
 * The organizer console dashboard: lists the caller's own authored concerts
 * (drafts and published) and offers per-row actions — edit (navigate to the
 * editor), publish (DRAFT → PUBLISHED), and cancel (terminal). The caller's
 * Organizer is resolved from the token, so `List` takes no argument.
 *
 * Publish and Cancel are confirmed in the template (a two-step reveal) and run
 * optimistically-guarded: the row is marked `busy` to disable its controls, and
 * on success the list is reloaded so the new state and any superseded discovered
 * slot are reflected. Errors are translated from `ConnectError` codes into
 * per-row copy via {@link toOrganizerErrorMessage}.
 */
export class ConcertsRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public rows: ConcertListRow[] = []

	/** Series id whose Cancel confirmation is currently revealed (single-open). */
	public confirmingCancelId = ''

	private abort: AbortController | null = null

	private readonly client = resolve(IConcertAuthoringClient)
	private readonly logger = resolve(ILogger).scopeTo('ConcertsRoute')

	public async attached(): Promise<void> {
		await this.load()
	}

	public detaching(): void {
		this.abort?.abort()
	}

	public async load(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const concerts = await this.client.list(abort.signal)
			if (abort.signal.aborted) return
			this.rows = concerts.map(toRow)
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.loadError = toOrganizerErrorMessage(
				err,
				'Failed to load your concerts.',
			)
			this.phase = 'error'
			this.logger.error('Failed to load concerts', err)
		}
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.rows.length === 0
	}

	public async publish(row: ConcertListRow): Promise<void> {
		if (row.busy || !row.canPublish) return
		row.busy = true
		row.actionError = ''
		try {
			await this.client.publish(row.seriesId)
			await this.load()
		} catch (err) {
			row.actionError = toOrganizerErrorMessage(err, 'Failed to publish.', {
				[Code.FailedPrecondition]:
					'This concert can no longer be published — it may be cancelled, already published, or its slot is claimed by another organizer.',
			})
			row.busy = false
			this.logger.error('Publish failed', { seriesId: row.seriesId, err })
		}
	}

	public confirmCancel(row: ConcertListRow): void {
		this.confirmingCancelId = row.seriesId
	}

	public dismissCancel(): void {
		this.confirmingCancelId = ''
	}

	public isConfirmingCancel(row: ConcertListRow): boolean {
		return this.confirmingCancelId === row.seriesId
	}

	public async cancel(row: ConcertListRow): Promise<void> {
		if (row.busy || !row.canCancel) return
		row.busy = true
		row.actionError = ''
		this.confirmingCancelId = ''
		try {
			await this.client.cancel(row.seriesId)
			await this.load()
		} catch (err) {
			row.actionError = toOrganizerErrorMessage(err, 'Failed to cancel.', {
				[Code.FailedPrecondition]: 'This concert is already cancelled.',
			})
			row.busy = false
			this.logger.error('Cancel failed', { seriesId: row.seriesId, err })
		}
	}
}
