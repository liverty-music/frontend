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
import {
	concertTitle,
	findConcert,
	paths,
	perAccountLimitOf,
	performs,
} from '../model/concert-model'
import { IArtistClient } from '../services/artist-client'
import { IClock } from '../services/clock'
import {
	ICoverPreviews,
	type PendingCover,
	watchCover,
} from '../services/cover-previews'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'
import { ISeriesImageClient } from '../services/series-image-client'
import { IVenueClient } from '../services/venue-client'
import { type Crumb, IBreadcrumbs } from '../shell/breadcrumbs'
import { IConsoleContext } from '../shell/console-context'
import { IPageProgress } from '../shell/page-progress'
import type { ConsoleField } from '../ui/console-field/console-field'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { ConsoleTimeField } from '../ui/console-time-field/console-time-field'
import type { UnsavedChanges } from '../ui/unsaved-changes/unsaved-changes'
import type { VenueField, VenuePick } from '../ui/venue-field/venue-field'
import {
	type ConcertFormErrors,
	type ConcertFormModel,
	emptyEventRow,
	emptyFormModel,
	hasFixedVenueAndDate,
	isFormValid,
	nextEventRow,
	toSeriesDraftInput,
	validateConcertForm,
} from './concert-form'
import { MAX_IMAGE_BYTES, validateCoverImage } from './cover-image'

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
 * the button and moves focus to the first field in error. A successful save
 * returns to the concert page (for a new concert, the new concert's page),
 * which shows the saved values, and confirms in the snackbar; a failed save
 * keeps the editor with what was entered and offers 再試行 (design D19). The
 * editor guards unsaved changes when left.
 *
 * Each date carries its own publish state: a PUBLISHED date keeps its venue
 * and date and cannot be removed, a CANCELLED date is read only, and once the
 * concert has one of those its type and visibility are fixed.
 *
 * Times are entered on a 24-hour clock (design D19): a new concert's first
 * date starts with 開場 17:00 and 開演 19:00, and 日程を追加 copies the
 * previous date's venue, date and times.
 *
 * Opened under an Artist (design D1): a new concert starts with that Artist as
 * its first performer, and a concert the Artist does not perform in is not
 * found.
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
	private readonly context = resolve(IConsoleContext)
	private readonly progress = resolve(IPageProgress)
	private readonly covers = resolve(ICoverPreviews)
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
	public startTimeFields: ConsoleTimeField[] = []
	public limitFields: ConsoleField[] = []

	/** The served cover, the picked image while it is processed, and the upload in flight. */
	public coverImageUrl = ''
	public pendingCover: PendingCover | undefined
	public coverNote: '' | 'processing' | 'slow' = ''
	/** Catalog key of the cover's error, translated in the template. */
	public coverImageError = ''
	public uploadingCover = false
	public readonly maxImageMiB = MAX_IMAGE_BYTES / (1024 * 1024)

	public readonly SeriesType = SeriesType
	public readonly PublishState = PublishState

	private stopCoverWatch: (() => void) | null = null
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
		void this.progress.track(this.bootstrap())
	}

	public detaching(): void {
		this.abort.abort()
		this.stopCoverWatch?.()
		this.stopCoverWatch = null
	}

	public canUnload(): Promise<boolean> {
		return this.guard?.confirmLeave() ?? Promise.resolve(true)
	}

	public get isEdit(): boolean {
		return this.seriesId !== ''
	}

	public get concertsHref(): string {
		return paths.concerts(this.context.scope)
	}

	public get concertHref(): string {
		return paths.concert(this.context.scope, this.seriesId)
	}

	/** Where キャンセル leads: the concert being edited, else Concerts. */
	public get cancelHref(): string {
		return this.isEdit ? this.concertHref : this.concertsHref
	}

	/** Once a date is published or cancelled, type and visibility are fixed. */
	public get isCorrection(): boolean {
		return this.model.events.some(hasFixedVenueAndDate)
	}

	public get isDirty(): boolean {
		return this.state === 'ready' && JSON.stringify(this.model) !== this.saved
	}

	/**
	 * The concert types, a radio group: M3 uses radio buttons for five or fewer
	 * choices (design D16).
	 */
	public readonly typeChoices = [
		{ value: SeriesType.SINGLE, labelKey: 'seriesType.single' },
		{ value: SeriesType.TOUR, labelKey: 'seriesType.tour' },
		{ value: SeriesType.FESTIVAL, labelKey: 'seriesType.festival' },
	]

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

	/** The picked image while it is processed, else the served cover. */
	public get renderedCover(): string {
		return this.pendingCover?.previewUrl || this.coverImageUrl
	}

	/** Field errors, recomputed as the member edits; shown after a save attempt. */
	public get errors(): ConcertFormErrors {
		return validateConcertForm(this.model)
	}

	/**
	 * A field's error key once a save was attempted; the field translates it.
	 * The template passes `submitted` so the binding re-evaluates when it
	 * changes.
	 */
	public error(key: string | undefined, submitted = this.submitted): string {
		return submitted && key ? key : ''
	}

	private async bootstrap(): Promise<void> {
		this.state = 'loading'
		try {
			const [roster, concerts] = await Promise.all([
				this.artists.list(this.abort.signal),
				this.isEdit ? this.series.list(this.abort.signal) : Promise.resolve([]),
			])
			const artistId = this.context.artistId
			if (this.isEdit) {
				const concert = findConcert(concerts, this.seriesId)
				if (!concert || !performs(concert, artistId)) {
					this.state = 'notFound'
					return
				}
				this.hydrate(concert)
				this.showPendingCover(concert)
			} else if (roster.some((a) => a.id?.value === artistId)) {
				// A new concert starts with the Artist it is created from, listed
				// first so it stays the first performer.
				this.model.artistIds = [artistId]
				roster.sort(
					(a, b) =>
						Number(b.id?.value === artistId) - Number(a.id?.value === artistId),
				)
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
			{ labelKey: 'shell.nav.concerts', href: this.concertsHref },
		]
		if (this.isEdit) {
			trail.push(
				{ label: this.model.title, href: this.concertHref },
				{ labelKey: 'concertEditor.editCrumb' },
			)
		} else {
			trail.push({ labelKey: 'concertEditor.newCrumb' })
		}
		this.breadcrumbs.set(trail)
	}

	private hydrate(concert: AuthoredSeries): void {
		const series = concert.series
		this.coverImageUrl = series.coverImage?.large?.value ?? ''
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
					// A published or cancelled date resends its listed venue name,
					// which Update compares to keep its venue fixed, even when no
					// place was matched; a draft needs a pick.
					venue:
						e.publishState !== PublishState.DRAFT
							? {
									placeId,
									name: e.listedVenueName?.value || e.venue?.name?.value || '',
									address: '',
								}
							: placeId
								? { placeId, name: e.venue?.name?.value ?? '', address: '' }
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
					perAccountLimit: String(perAccountLimitOf(e)),
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

	/** 日程を追加: a new draft date copying the previous one (design D19). */
	public addEvent(): void {
		this.model.events.push(nextEventRow(this.model.events.at(-1)))
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
				await this.series.update(this.seriesId, draft)
				this.markSaved()
				this.snackbar.show('concertEditor.saved')
				await this.router.load(this.savedHref(this.seriesId))
			} else {
				const concert = await this.series.create(draft)
				const id = concert?.series.id?.value
				this.markSaved()
				this.snackbar.show('concertEditor.created')
				if (id) await this.router.load(this.savedHref(id))
			}
		} catch (err) {
			this.logger.warn('Save failed', err)
			const precondition =
				err instanceof ConnectError && err.code === Code.FailedPrecondition
			this.snackbar.showError(
				!precondition
					? 'concertEditor.saveFailed'
					: this.publishedStartTimeChanged()
						? 'concertEditor.startTimeOnSale'
						: 'concertEditor.saveRejected',
				precondition ? {} : { retry: () => void this.save() },
			)
		}
	}

	/**
	 * The saved concert's page: under the Artist the editor was opened from,
	 * or under its first performer when the member took that Artist off.
	 */
	private savedHref(id: string): string {
		const artist = this.model.artistIds.includes(this.context.artistId)
			? this.context.artistId
			: (this.model.artistIds[0] ?? this.context.artistId)
		return paths.concert(this.context.scopeOf(artist), id)
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
			(r) => r.venueName || r.localDate || r.time || r.perAccountLimit,
		)
		if (row < 0) return
		const errors = this.errors.rows[row]
		if (errors.venueName) this.venueFields[row]?.focus()
		else if (errors.localDate) this.dateFields[row]?.focus()
		else if (errors.time) this.startTimeFields[row]?.focus()
		else this.limitFields[row]?.focus()
	}

	/**
	 * Uploads the picked cover: CreateUploadUrl, PUT to the signed URL, then
	 * SetCoverImage. The picked file shows at once and is handed to the cover
	 * store, so the concert page a save returns to shows it too (design D19);
	 * the editor then re-reads the concert every 3 s for up to 60 s and swaps
	 * to the processed image once the Series' cover is the uploaded one (D9a).
	 */
	public async onCoverSelected(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement
		const file = input.files?.[0]
		if (!file) return
		this.coverImageError = ''
		const check = validateCoverImage(file)
		if ('messageKey' in check) {
			this.coverImageError = check.messageKey
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
			this.pendingCover = this.covers.hold(
				this.seriesId,
				upload.seriesImageId,
				file,
			)
			this.coverNote = 'processing'
			this.startCoverWatch()
		} catch (err) {
			this.logger.warn('Cover upload failed', err)
			this.coverImageError = 'concertEditor.cover.failed'
		} finally {
			this.uploadingCover = false
			input.value = ''
		}
	}

	/** Reopened while a picked cover is still processed: show it and wait (D9a). */
	private showPendingCover(concert: AuthoredSeries): void {
		this.pendingCover = this.covers.settle(
			this.seriesId,
			concert.series.coverImage?.id?.value,
		)
		if (!this.pendingCover) return
		this.coverNote = 'processing'
		this.startCoverWatch()
	}

	private startCoverWatch(): void {
		this.stopCoverWatch?.()
		this.stopCoverWatch = watchCover({
			read: async () => {
				const concert = findConcert(
					await this.series.list(this.abort.signal),
					this.seriesId,
				)
				const cover = concert?.series.coverImage
				if (!cover?.large?.value) return undefined
				this.coverImageUrl = cover.large.value
				return cover.id?.value
			},
			served: (coverId) => {
				this.pendingCover = this.covers.settle(this.seriesId, coverId)
				if (this.pendingCover) return false
				this.coverNote = ''
				return true
			},
			slow: () => {
				this.coverNote = 'slow'
			},
			now: () => this.clock.now(),
		})
	}
}
