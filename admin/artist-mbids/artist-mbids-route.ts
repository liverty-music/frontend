import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { type Artist, IArtistClient } from '../services/artist-client'
import {
	type CatalogArtist,
	ICatalogArtistClient,
} from '../services/catalog-artist-client'

/** Where a read stands. */
export type ReadPhase = 'loading' | 'ready' | 'error'

/** An Ambiguous artist as listed. */
export interface ArtistRow {
	readonly id: string
	readonly name: string
	readonly mbid: string
}

/** A namesake candidate as shown. */
export interface NamesakeRow {
	readonly mbid: string
	readonly name: string
	readonly country: string
	readonly lifeSpan: string
	readonly disambiguation: string
	readonly officialSiteUrl: string
	/** The candidate's page in the music catalog. */
	readonly catalogUrl: string
	/** Whether the candidate is the artist's current MBID. */
	readonly current: boolean
}

/** The MBID a confirmation dialog would set, and how it describes it. */
export interface PendingChoice {
	readonly mbid: string
	/** The namesake's name, country and life span; empty for an entered MBID. */
	readonly description: string
}

const MBID_LENGTH = 36
const CATALOG_ARTIST_URL = 'https://musicbrainz.org/artist/'
const GENERIC_FAILURE = 'The MBID could not be set. Try again.'

/** Formats a catalog date as precise as it is recorded: 2018, 1995-10, 2013-05-17. */
function formatDate(
	date: { year: number; month: number; day: number } | undefined,
): string {
	if (!date || date.year === 0) return ''
	const parts = [String(date.year).padStart(4, '0')]
	if (date.month > 0) {
		parts.push(String(date.month).padStart(2, '0'))
		if (date.day > 0) parts.push(String(date.day).padStart(2, '0'))
	}
	return parts.join('-')
}

/**
 * The life span in one of six forms: `<begin> to <end>`, `<begin> ended`,
 * `<begin> active`, `to <end>`, `ended` or `active`.
 */
export function formatLifeSpan(candidate: CatalogArtist): string {
	const begin = formatDate(candidate.begin?.value)
	const end = formatDate(candidate.end?.value)
	const tail = end ? `to ${end}` : candidate.activityEnded ? 'ended' : 'active'
	return begin ? `${begin} ${tail}` : tail
}

function toArtistRow(artist: Artist): ArtistRow {
	return {
		id: artist.id?.value ?? '',
		name: artist.name?.value ?? '',
		mbid: artist.mbid?.value ?? '',
	}
}

function toNamesakeRow(
	candidate: CatalogArtist,
	currentMbid: string,
): NamesakeRow {
	const mbid = candidate.mbid?.value ?? ''
	return {
		mbid,
		name: candidate.name?.value ?? '',
		country: candidate.country?.value ?? '',
		lifeSpan: formatLifeSpan(candidate),
		disambiguation: candidate.disambiguation?.value ?? '',
		officialSiteUrl: candidate.officialSiteUrl?.value ?? '',
		catalogUrl: `${CATALOG_ARTIST_URL}${mbid}`,
		current: mbid === currentMbid,
	}
}

function describe(row: NamesakeRow): string {
	return [row.name, row.country, row.lifeSpan].filter(Boolean).join(', ')
}

/**
 * The admin console's Artist MBIDs screen (OpenSpec change
 * `verify-artist-mbid`, spec `route/artist-mbids`): it lists the artists whose
 * MBID could not be verified automatically, shows the music catalog's
 * namesakes of the selected one, and sets the MBID the admin chooses or
 * enters, after a confirmation.
 *
 * Every value it shows comes from `ArtistService.ListByMbidStatus` and
 * `CatalogArtistService.ListByArtist`; nothing is kept between visits.
 */
export class ArtistMbidsRoute {
	private readonly artistClient = resolve(IArtistClient)
	private readonly catalogClient = resolve(ICatalogArtistClient)
	private readonly logger = resolve(ILogger).scopeTo('ArtistMbidsRoute')

	public readonly mbidLength = MBID_LENGTH

	public listPhase: ReadPhase = 'loading'
	public artists: ArtistRow[] = []
	public selected: ArtistRow | null = null

	public namesakePhase: ReadPhase = 'loading'
	public namesakes: NamesakeRow[] = []

	/** The MBID field. */
	public mbidInput = ''
	public mbidError = ''

	/** Choice state. */
	public pending: PendingChoice | null = null
	public saving = false
	public choiceError = ''
	/** Set after a correction: the name the call returned. */
	public verifiedName = ''

	/** Bound via `ref` to the confirmation dialog and its Cancel control. */
	public choiceDialog?: HTMLDialogElement
	public choiceCancelButton?: HTMLButtonElement

	private namesakeAbort: AbortController | null = null

	public async loading(): Promise<void> {
		await this.loadArtists()
	}

	public detaching(): void {
		this.namesakeAbort?.abort()
	}

	public async loadArtists(): Promise<void> {
		this.listPhase = 'loading'
		try {
			this.artists = (await this.artistClient.listAmbiguous()).map(toArtistRow)
			this.listPhase = 'ready'
		} catch (err) {
			this.logger.error('List ambiguous artists failed', { err })
			this.listPhase = 'error'
		}
	}

	/** Selects a listed artist and reads its namesakes. */
	public async select(artist: ArtistRow): Promise<void> {
		this.selected = artist
		this.mbidInput = ''
		this.mbidError = ''
		this.choiceError = ''
		this.verifiedName = ''
		await this.loadNamesakes()
	}

	public async loadNamesakes(): Promise<void> {
		const artist = this.selected
		if (!artist) return
		this.namesakeAbort?.abort()
		const abort = new AbortController()
		this.namesakeAbort = abort
		this.namesakePhase = 'loading'
		this.namesakes = []
		try {
			const candidates = await this.catalogClient.listByArtist(
				artist.id,
				abort.signal,
			)
			if (abort.signal.aborted) return
			this.namesakes = candidates.map((c) => toNamesakeRow(c, artist.mbid))
			this.namesakePhase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.logger.error('List namesakes failed', { artistId: artist.id, err })
			this.namesakePhase = 'error'
		}
	}

	/** `Choose` on a namesake: opens the confirmation. */
	public choose(row: NamesakeRow): void {
		this.openDialog({ mbid: row.mbid, description: describe(row) })
	}

	/** `Set MBID`: checks the entered value, then opens the confirmation. */
	public setMbid(): void {
		const mbid = this.mbidInput.trim()
		if (mbid.length !== MBID_LENGTH) {
			this.mbidError = 'Enter an MBID of 36 characters.'
			return
		}
		this.mbidError = ''
		this.openDialog({ mbid, description: '' })
	}

	private openDialog(choice: PendingChoice): void {
		if (!this.selected || this.saving) return
		this.pending = choice
		this.choiceError = ''
		// Guarded: jsdom does not implement showModal.
		try {
			this.choiceDialog?.showModal()
		} catch {
			/* non-interactive environment: VM state still drives the flow */
		}
		// Setting the MBID is hard to undo, so the least destructive control
		// takes focus (WAI-ARIA APG dialog pattern).
		this.choiceCancelButton?.focus()
	}

	public cancelChoice(): void {
		this.closeDialog()
	}

	/** Runs on every close of the dialog, Escape included. */
	public onDialogClose(): void {
		if (!this.saving) this.pending = null
	}

	public async confirmChoice(): Promise<void> {
		const artist = this.selected
		const choice = this.pending
		if (!artist || !choice || this.saving) return
		this.saving = true
		try {
			const corrected = await this.artistClient.correctMbid(
				artist.id,
				choice.mbid,
			)
			this.artists = this.artists.filter((a) => a.id !== artist.id)
			this.selected = null
			this.namesakes = []
			this.verifiedName = corrected?.name?.value || artist.name
		} catch (err) {
			this.choiceError = this.explain(err)
			if (this.choiceError === GENERIC_FAILURE) {
				this.logger.error('Correct MBID failed', {
					artistId: artist.id,
					mbid: choice.mbid,
					err,
				})
			}
		} finally {
			this.saving = false
			this.closeDialog()
		}
	}

	private explain(err: unknown): string {
		if (err instanceof ConnectError) {
			if (err.code === Code.AlreadyExists) {
				return 'Another artist already has this MBID.'
			}
			if (err.code === Code.NotFound) {
				return 'The music catalog has no artist with this MBID.'
			}
		}
		return GENERIC_FAILURE
	}

	private closeDialog(): void {
		this.pending = null
		try {
			this.choiceDialog?.close()
		} catch {
			/* non-interactive environment */
		}
	}
}
