import { I18N } from '@aurelia/i18n'
import { IRouter, type Params } from '@aurelia/router'
import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { toJstTimeInput } from '../i18n/format'
import { concertTitle, findConcert, paths } from '../model/concert-model'
import { IArtistClient } from '../services/artist-client'
import { IClock } from '../services/clock'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'
import { ISeriesImageClient } from '../services/series-image-client'
import { IVenueClient } from '../services/venue-client'
import { type Crumb, IBreadcrumbs } from '../shell/breadcrumbs'
import type { ConsoleField } from '../ui/console-field/console-field'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { UnsavedChanges } from '../ui/unsaved-changes/unsaved-changes'
import type { VenueField, VenuePick } from '../ui/venue-field/venue-field'
import {
	type ConcertFormErrors,
	type ConcertFormModel,
	emptyEventRow,
	emptyFormModel,
	hasFixedVenueAndDate,
	isFormValid,
	toSeriesDraftInput,
	validateConcertForm,
} from './concert-form'
import { MAX_IMAGE_BYTES, validateCoverImage } from './cover-image'

/** How often, and how long, the editor checks for the processed cover (D9a). */
export const COVER_POLL_MS = 3000
export const COVER_POLL_LIMIT_MS = 60_000

/** A performer option for the checkboxes, from the represented artists. */
export interface PerformerOption {
	readonly id: string
	readonly name: string
	selected: boolean
}

function performerOption(artist: Artist, selected: boolean): PerformerOption {
	return {
		id: artist.id?.value ?? '',
		name: artist.name?.value ?? '',
		selected,
	}
}

/**
 * Creates or edits a concert. The venue of each date is a place picked from
 * the map catalog; dates and times are Japan time. Saving shows progress in
 * the button, reports the result in the snackbar, moves focus to the first
 * field in error, and the editor guards unsaved changes when left.
 *
 * Each date carries its own publish state: a PUBLISHED date keeps its venue
 * and date and cannot be removed, a CANCELLED date is read only, and once the
 * concert has one of those its type and visibility are fixed.
 */
export class ConcertEditorRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly seriesImages = resolve(ISeriesImageClient)
	private readonly artists = resolve(IArtistClient)
	private readonly venues = resolve(IVenueClient)
	private readonly router = resolve(IRouter)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	private readonly i18n = resolve(I18N)
	private readonly logger = resolve(ILogger).scopeTo('ConcertEditorRoute')

	public state: 'loading' | 'ready' | 'notFound' | 'error' = 'loading'
	public seriesId = ''
	public model: ConcertFormModel = emptyFormModel()
	public submitted = false
	public performers: PerformerOption[] = []
	public guard!: UnsavedChanges
	public titleField!: ConsoleField
	public performersFieldset!: HTMLFieldSetElement
	public venueFields: VenueField[] = []
	public dateFields: ConsoleField[] = []

	/** The served cover, the picked file's preview, and the upload in flight. */
	public coverImageUrl = ''
	public localPreviewUrl = ''
	public coverNote: '' | 'processing' | 'slow' = ''
	public coverImageError = ''
	public uploadingCover = false
	public readonly maxImageMiB = MAX_IMAGE_BYTES / (1024 * 1024)

	public readonly SeriesType = SeriesType
	public readonly PublishState = PublishState

	/** The SeriesImage just set as the cover, until the processed one is served. */
	private pendingCoverId = ''
	private coverTimer: ReturnType<typeof setTimeout> | null = null
	private saved = ''
	/** Start times of the stored PUBLISHED events as loaded, by event id. */
	private publishedStartTimes = new Map<string, string>()
	private abort = new AbortController()

	public readonly search = (text: string): Promise<VenuePick[]> =>
		this.venues.search(text, this.abort.signal)

	public loading(params: Params): void {
		this.seriesId = params.seriesId ?? ''
	}

	public attached(): void {
		void this.bootstrap()
	}

	public detaching(): void {
		this.abort.abort()
		this.stopCoverPoll()
		this.revokeLocalPreview()
	}

	public canUnload(): Promise<boolean> {
		return this.guard?.confirmLeave() ?? Promise.resolve(true)
	}

	public get isEdit(): boolean {
		return this.seriesId !== ''
	}

	/** Once a date is published or cancelled, type and visibility are fixed. */
	public get isCorrection(): boolean {
		return this.model.events.some(hasFixedVenueAndDate)
	}

	public get isDirty(): boolean {
		return this.state === 'ready' && JSON.stringify(this.model) !== this.saved
	}

	public get typeValue(): string {
		return String(this.model.type)
	}

	public set typeValue(value: string) {
		this.model.type = Number(value) as SeriesType
	}

	public get typeOptions() {
		return [
			{
				value: String(SeriesType.SINGLE),
				label: this.i18n.tr('seriesType.single'),
			},
			{
				value: String(SeriesType.TOUR),
				label: this.i18n.tr('seriesType.tour'),
			},
			{
				value: String(SeriesType.FESTIVAL),
				label: this.i18n.tr('seriesType.festival'),
			},
		]
	}

	/** The two visibilities, each with its effect on fans (design D14). */
	public readonly visibilityChoices = [
		{
			value: Visibility.PUBLIC,
			labelKey: 'visibility.public',
			effectKey: 'concertEditor.visibilityPublic',
		},
		{
			value: Visibility.UNLISTED,
			labelKey: 'visibility.unlisted',
			effectKey: 'concertEditor.visibilityUnlisted',
		},
	]

	/** The served cover, else the picked file while it is processed. */
	public get renderedCover(): string {
		return this.localPreviewUrl || this.coverImageUrl
	}

	/** Field errors, recomputed as the operator edits; shown after a save attempt. */
	public get errors(): ConcertFormErrors {
		return validateConcertForm(this.model)
	}

	/**
	 * A field's translated error once a save was attempted. The template passes
	 * `submitted` so the binding re-evaluates when it changes.
	 */
	public error(key: string | undefined, submitted = this.submitted): string {
		return submitted && key ? this.i18n.tr(key) : ''
	}

	private async bootstrap(): Promise<void> {
		this.state = 'loading'
		try {
			const [roster, concerts] = await Promise.all([
				this.artists.list(this.abort.signal),
				this.isEdit ? this.series.list(this.abort.signal) : Promise.resolve([]),
			])
			if (this.isEdit) {
				const concert = findConcert(concerts, this.seriesId)
				if (!concert) {
					this.state = 'notFound'
					return
				}
				this.hydrate(concert)
			}
			const selected = new Set(this.model.artistIds)
			this.performers = roster.map((a) =>
				performerOption(a, selected.has(a.id?.value ?? '')),
			)
			this.setBreadcrumb()
			this.markSaved()
			this.state = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Editor bootstrap failed', err)
			this.state = 'error'
		}
	}

	private setBreadcrumb(): void {
		const trail: Crumb[] = [
			{ labelKey: 'shell.nav.concerts', href: paths.concerts },
		]
		if (this.isEdit) {
			trail.push(
				{ label: this.model.title, href: paths.concert(this.seriesId) },
				{ labelKey: 'concertEditor.editCrumb' },
			)
		} else {
			trail.push({ labelKey: 'concertEditor.newCrumb' })
		}
		this.breadcrumbs.set(trail)
	}

	private hydrate(concert: AuthoredSeries): void {
		const series = concert.series
		// While a newly set cover is processed, keep its preview (D9a).
		if (!this.pendingCoverId) {
			this.coverImageUrl = series.coverImage?.large?.value ?? ''
		}
		this.model = {
			title: concertTitle(concert),
			description: series.description?.value ?? '',
			type: series.type || SeriesType.SINGLE,
			visibility: series.visibility || Visibility.PUBLIC,
			sourceUrl: series.sourceUrl?.value ?? '',
			artistIds: concert.performers
				.map((p) => p.id?.value ?? '')
				.filter(Boolean),
			events: concert.events.map((e) => {
				const d = e.localDate?.value
				const placeId = e.venue?.placeId?.value ?? ''
				return {
					eventId: e.id?.value ?? '',
					publishState: e.publishState,
					// The place the date was matched to is kept on save.
					// A published or cancelled date keeps its venue name on screen
					// even when no place was matched; a draft needs a pick.
					venue:
						placeId || e.publishState !== PublishState.DRAFT
							? {
									placeId,
									name: e.venue?.name?.value || e.listedVenueName?.value || '',
									address: '',
								}
							: null,
					localDate: d
						? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
						: '',
					startTime: e.startTime?.value
						? toJstTimeInput(timestampDate(e.startTime.value))
						: '',
					openTime: e.openTime?.value
						? toJstTimeInput(timestampDate(e.openTime.value))
						: '',
				}
			}),
		}
		if (this.model.events.length === 0) this.model.events.push(emptyEventRow())
		this.publishedStartTimes = new Map(
			this.model.events
				.filter(
					(row) => row.eventId && row.publishState === PublishState.PUBLISHED,
				)
				.map((row) => [row.eventId, row.startTime]),
		)
	}

	/** True when a stored PUBLISHED event's start time differs from the loaded one. */
	private publishedStartTimeChanged(): boolean {
		return this.model.events.some(
			(row) =>
				this.publishedStartTimes.has(row.eventId) &&
				this.publishedStartTimes.get(row.eventId) !== row.startTime,
		)
	}

	private markSaved(): void {
		this.saved = JSON.stringify(this.model)
	}

	public togglePerformer(option: PerformerOption): void {
		option.selected = !option.selected
		this.model.artistIds = this.performers
			.filter((p) => p.selected)
			.map((p) => p.id)
	}

	public addEvent(): void {
		this.model.events.push(emptyEventRow())
	}

	public removeEvent(index: number): void {
		if (this.model.events.length <= 1) return
		if (this.model.events[index]?.publishState !== PublishState.DRAFT) return
		this.model.events.splice(index, 1)
	}

	/** Saves; a field error goes next to its field and takes focus. */
	public async save(): Promise<void> {
		this.submitted = true
		if (!isFormValid(this.errors)) {
			queueMicrotask(() => this.focusFirstError())
			return
		}
		const draft = toSeriesDraftInput(this.model)
		try {
			if (this.isEdit) {
				const concert = await this.series.update(this.seriesId, draft)
				if (concert) this.hydrate(concert)
				this.markSaved()
				this.setBreadcrumb()
				this.snackbar.show(this.i18n.tr('concertEditor.saved'))
			} else {
				const concert = await this.series.create(draft)
				const id = concert?.series.id?.value
				this.markSaved()
				this.snackbar.show(this.i18n.tr('concertEditor.created'))
				if (id) await this.router.load(paths.concert(id))
			}
		} catch (err) {
			this.logger.warn('Save failed', err)
			const precondition =
				err instanceof ConnectError && err.code === Code.FailedPrecondition
			this.snackbar.showError(
				this.i18n.tr(
					!precondition
						? 'concertEditor.saveFailed'
						: this.publishedStartTimeChanged()
							? 'concertEditor.startTimeOnSale'
							: 'concertEditor.saveRejected',
				),
				precondition
					? undefined
					: {
							label: this.i18n.tr('common.retry'),
							callback: () => void this.save(),
						},
			)
		}
	}

	private focusFirstError(): void {
		if (this.errors.title) {
			this.titleField?.focus()
			return
		}
		if (this.errors.artistIds) {
			this.performersFieldset?.querySelector('input')?.focus()
			return
		}
		const row = this.errors.rows.findIndex(
			(r) => r.venueName || r.localDate || r.time,
		)
		if (row < 0) return
		const errors = this.errors.rows[row]
		if (errors.venueName) this.venueFields[row]?.focus()
		else this.dateFields[row]?.focus()
	}

	/**
	 * Uploads the picked cover: CreateUploadUrl, PUT to the signed URL, then
	 * SetCoverImage. The picked file shows at once; the editor then re-reads
	 * the concert every 3 s for up to 60 s and swaps to the processed image once
	 * the Series' cover is the uploaded one (D9a).
	 */
	public async onCoverSelected(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement
		const file = input.files?.[0]
		if (!file) return
		this.coverImageError = ''
		const check = validateCoverImage(file)
		if ('messageKey' in check) {
			this.coverImageError = this.i18n.tr(check.messageKey)
			input.value = ''
			return
		}
		this.uploadingCover = true
		try {
			const upload = await this.seriesImages.createUploadUrl(
				file.type,
				this.abort.signal,
			)
			await this.seriesImages.uploadToSignedUrl(
				upload,
				file,
				file.type,
				this.abort.signal,
			)
			await this.series.setCoverImage(
				this.seriesId,
				upload.seriesImageId,
				this.abort.signal,
			)
			this.revokeLocalPreview()
			this.localPreviewUrl = URL.createObjectURL(file)
			this.coverNote = 'processing'
			this.pendingCoverId = upload.seriesImageId
			this.startCoverPoll()
		} catch (err) {
			this.logger.warn('Cover upload failed', err)
			this.coverImageError = this.i18n.tr('concertEditor.cover.failed')
		} finally {
			this.uploadingCover = false
			input.value = ''
		}
	}

	private startCoverPoll(): void {
		this.stopCoverPoll()
		const startedAt = this.clock.now()
		const tick = async () => {
			try {
				const concert = findConcert(
					await this.series.list(this.abort.signal),
					this.seriesId,
				)
				const cover = concert?.series.coverImage
				if (cover?.id?.value === this.pendingCoverId && cover.large?.value) {
					this.coverImageUrl = cover.large.value
					this.pendingCoverId = ''
					this.coverNote = ''
					this.revokeLocalPreview()
					return
				}
			} catch (err) {
				if (this.abort.signal.aborted) return
				this.logger.debug('Cover check failed', err)
			}
			if (this.clock.now() - startedAt >= COVER_POLL_LIMIT_MS) {
				this.coverNote = 'slow'
				return
			}
			this.coverTimer = setTimeout(tick, COVER_POLL_MS)
		}
		this.coverTimer = setTimeout(tick, COVER_POLL_MS)
	}

	private stopCoverPoll(): void {
		if (this.coverTimer !== null) clearTimeout(this.coverTimer)
		this.coverTimer = null
	}

	private revokeLocalPreview(): void {
		if (this.localPreviewUrl) {
			URL.revokeObjectURL(this.localPreviewUrl)
			this.localPreviewUrl = ''
		}
	}
}
