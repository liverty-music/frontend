import { IRouter, type Params } from '@aurelia/router'
import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { ILogger, resolve } from 'aurelia'
import {
	type AuthoredConcert,
	IConcertAuthoringClient,
} from '../services/concert-authoring-client'
import { Code, toOrganizerErrorMessage } from '../services/connect-error-copy'
import { IOrganizerIdentityClient } from '../services/organizer-identity-client'
import {
	type ConcertFormErrors,
	type ConcertFormModel,
	emptyEventRow,
	emptyFormModel,
	isFormValid,
	toSeriesDraftInput,
	validateConcertForm,
} from './concert-form'
import { MAX_IMAGE_BYTES, validateCoverImage } from './cover-image'

/** Coarse lifecycle phase for the initial editor bootstrap. */
type LoadPhase = 'loading' | 'ready' | 'error'

const EMPTY = '—'

/** A performer option for the multi-select, flattened from the roster. */
export interface PerformerOption {
	readonly id: string
	readonly name: string
	selected: boolean
}

function toPerformerOption(artist: Artist, selected: boolean): PerformerOption {
	return {
		id: artist.id?.value ?? '',
		name: artist.name?.value ?? EMPTY,
		selected,
	}
}

/**
 * The create/edit editor for a first-party concert. One component serves both
 * modes: the `edit/:seriesId` route supplies a series id (edit), its absence is
 * the `new` route (create).
 *
 * On bootstrap it resolves the caller's own Organizer via
 * {@link IOrganizerIdentityClient} (the sanctioned token bootstrap) and loads
 * the represented-artists roster for the performer picker. In edit mode it also
 * loads the existing concert from `List` (the organizer catalog is small and
 * has no single-get RPC) and hydrates the form.
 *
 * Validation mirrors the backend boundary (see {@link validateConcertForm}) and
 * runs on every input so inline errors appear before a round-trip. Save calls
 * Create or Update; on a successful Create it redirects into the edit route so
 * the now-persisted series id unlocks cover-image upload and the publish/token
 * affordances. A PUBLISHED series edit is a correction — the backend rejects
 * disallowed edits with FAILED_PRECONDITION, which is surfaced rather than
 * assumed to succeed.
 */
export class ConcertEditorRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''

	/** Edit mode when set; create mode when empty. */
	public seriesId = ''
	public publishState: PublishState = PublishState.UNSPECIFIED

	public model: ConcertFormModel = emptyFormModel()
	public errors: ConcertFormErrors = { rows: [{}] }
	/** Set true after the first save attempt so errors are not shown pre-emptively. */
	public submitted = false
	public saving = false
	public saveError = ''

	public performers: PerformerOption[] = []

	// Cover image (edit mode only — requires a persisted series id). The served
	// `large` variant is 404 until async processing completes, so an optimistic
	// object-URL preview of the just-picked file bridges the gap (and is the
	// fallback if the variant never appears). See onCoverSelected / renderedCover.
	public coverImageUrl = ''
	/** Object URL of the locally picked file; shown until the variant is live. */
	public localPreviewUrl = ''
	/** Set when the served variant 404s (still processing or never produced). */
	public coverVariantBroken = false
	public coverImageError = ''
	public uploadingCover = false

	private organizerId = ''
	private abort: AbortController | null = null

	private readonly client = resolve(IConcertAuthoringClient)
	private readonly identity = resolve(IOrganizerIdentityClient)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ConcertEditorRoute')

	// Expose enums to the template for the type selector. Visibility is not
	// selectable in the MVP: every authored concert is PUBLIC (unlisted viewing
	// ships later as a complete vertical slice), so the form value stays PUBLIC.
	public readonly SeriesType = SeriesType
	public readonly PublishState = PublishState
	public readonly maxImageMiB = MAX_IMAGE_BYTES / (1024 * 1024)

	public canLoad(params: Params): boolean {
		this.seriesId = params.seriesId ?? ''
		return true
	}

	public async attached(): Promise<void> {
		await this.bootstrap()
	}

	public detaching(): void {
		this.abort?.abort()
		this.revokeLocalPreview()
	}

	public get isEdit(): boolean {
		return this.seriesId !== ''
	}

	public get isPublished(): boolean {
		return this.publishState === PublishState.PUBLISHED
	}

	/**
	 * The cover source to render: the served `large` variant when it is live,
	 * otherwise the optimistic local preview. Falls back to the preview when the
	 * variant 404s (still processing, or never produced — the operator re-uploads).
	 */
	public get renderedCover(): string {
		if (this.coverImageUrl && !this.coverVariantBroken)
			return this.coverImageUrl
		return this.localPreviewUrl
	}

	/** True while the served variant is not yet available but a preview exists. */
	public get coverProcessing(): boolean {
		return (
			this.localPreviewUrl !== '' && this.renderedCover === this.localPreviewUrl
		)
	}

	/** The served variant 404'd (processing not finished, or failed): fall back. */
	public onCoverError(): void {
		this.coverVariantBroken = true
	}

	private revokeLocalPreview(): void {
		if (this.localPreviewUrl) {
			URL.revokeObjectURL(this.localPreviewUrl)
			this.localPreviewUrl = ''
		}
	}

	private async bootstrap(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const organizer = await this.identity.get(abort.signal)
			this.organizerId = organizer?.id?.value ?? ''
			const roster = this.organizerId
				? await this.identity.listArtists(this.organizerId, abort.signal)
				: []
			if (abort.signal.aborted) return

			if (this.isEdit) {
				const concert = await this.loadConcert(this.seriesId, abort.signal)
				if (abort.signal.aborted) return
				if (!concert) {
					this.loadError = 'That concert no longer exists.'
					this.phase = 'error'
					return
				}
				this.hydrate(concert)
			}

			const selectedIds = new Set(this.model.artistIds)
			this.performers = roster.map((a) =>
				toPerformerOption(a, selectedIds.has(a.id?.value ?? '')),
			)
			this.revalidate()
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.loadError = toOrganizerErrorMessage(
				err,
				'Failed to open the editor.',
			)
			this.phase = 'error'
			this.logger.error('Editor bootstrap failed', err)
		}
	}

	private async loadConcert(
		seriesId: string,
		signal: AbortSignal,
	): Promise<AuthoredConcert | undefined> {
		const concerts = await this.client.list(signal)
		return concerts.find((c) => c.series?.id?.value === seriesId)
	}

	private hydrate(concert: AuthoredConcert): void {
		const series = concert.series
		this.publishState = series?.publishState ?? PublishState.UNSPECIFIED
		// The editor renders the full-width `large` variant; a list would use
		// `thumb`. Both 404 until async processing finishes (see renderedCover).
		const nextCover = series?.media?.attributes?.large?.value ?? ''
		if (nextCover !== this.coverImageUrl) this.coverVariantBroken = false
		this.coverImageUrl = nextCover
		this.model = {
			title: series?.title?.value ?? '',
			description: series?.description?.value ?? '',
			type: series?.type ?? SeriesType.SINGLE,
			visibility: series?.visibility ?? Visibility.PUBLIC,
			artistIds: concert.performers
				.map((p) => p.id?.value ?? '')
				.filter(Boolean),
			events: concert.events.map((e) => ({
				venueName: e.venue?.name?.value ?? '',
				placeId: '',
				localDate: e.localDate?.value
					? `${e.localDate.value.year}-${String(e.localDate.value.month).padStart(2, '0')}-${String(e.localDate.value.day).padStart(2, '0')}`
					: '',
				startTime: e.startTime?.value
					? this.hhmm(e.startTime.value.toDate())
					: '',
				openTime: e.openTime?.value ? this.hhmm(e.openTime.value.toDate()) : '',
			})),
		}
		if (this.model.events.length === 0) {
			this.model.events.push(emptyEventRow())
		}
	}

	private hhmm(date: Date): string {
		return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
	}

	// --- Form editing -------------------------------------------------------

	public revalidate(): void {
		this.errors = validateConcertForm(this.model, {
			allowPastDates: this.isPublished,
		})
	}

	public togglePerformer(option: PerformerOption): void {
		option.selected = !option.selected
		this.model.artistIds = this.performers
			.filter((p) => p.selected)
			.map((p) => p.id)
		this.revalidate()
	}

	public addEvent(): void {
		this.model.events.push(emptyEventRow())
		this.revalidate()
	}

	public removeEvent(index: number): void {
		if (this.model.events.length <= 1) return
		this.model.events.splice(index, 1)
		this.revalidate()
	}

	public get formValid(): boolean {
		return isFormValid(this.errors)
	}

	// --- Save ---------------------------------------------------------------

	public async save(): Promise<void> {
		if (this.saving) return
		this.submitted = true
		this.revalidate()
		if (!this.formValid) return
		this.saving = true
		this.saveError = ''
		const draft = toSeriesDraftInput(this.model)
		try {
			if (this.isEdit) {
				const concert = await this.client.update(this.seriesId, draft)
				if (concert) this.hydrate(concert)
			} else {
				const concert = await this.client.create(draft)
				const newId = concert?.series?.id?.value
				if (newId) {
					// Redirect into edit mode so the persisted id unlocks cover upload
					// and the publish/token affordances.
					await this.router.load(`../concerts/edit/${newId}`)
					return
				}
			}
		} catch (err) {
			this.saveError = toOrganizerErrorMessage(err, 'Failed to save.', {
				[Code.FailedPrecondition]: this.isPublished
					? 'Published concerts only allow correction edits; this change was rejected.'
					: 'This concert can no longer be edited.',
			})
			this.logger.error('Save failed', { seriesId: this.seriesId, err })
		} finally {
			this.saving = false
		}
	}

	// --- Cover image --------------------------------------------------------

	/**
	 * Runs the async cover-image pipeline for the picked file:
	 * `createMediaUploadUrl` → direct `PUT` to the signed GCS URL → `attachMedia`.
	 * On a successful attach it shows an optimistic object-URL preview of the
	 * picked file, since the served variant is not live until async processing
	 * finishes (see {@link renderedCover}). The client-side type/size pre-check
	 * still runs first so an invalid file never round-trips.
	 */
	public async onCoverSelected(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement
		const file = input.files?.[0]
		if (!file) return
		this.coverImageError = ''
		const check = validateCoverImage(file)
		if (!check.ok) {
			this.coverImageError = check.message
			input.value = ''
			return
		}
		const signal = this.abort?.signal
		this.uploadingCover = true
		try {
			const ticket = await this.client.createMediaUploadUrl(file.type, signal)
			await this.client.uploadToSignedUrl(ticket, file, file.type, signal)
			await this.client.attachMedia(this.seriesId, ticket.mediaId, signal)
			// Processing is async: the served variant 404s until it completes, so
			// show the local file optimistically and let it bridge to the variant.
			this.revokeLocalPreview()
			this.localPreviewUrl = URL.createObjectURL(file)
			this.coverVariantBroken = false
			this.coverImageUrl = ''
		} catch (err) {
			this.coverImageError = toOrganizerErrorMessage(
				err,
				'Failed to upload the image.',
			)
			this.logger.error('Cover upload failed', { seriesId: this.seriesId, err })
		} finally {
			this.uploadingCover = false
			input.value = ''
		}
	}
}
