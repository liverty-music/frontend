import { ILogger, resolve } from 'aurelia'
import { EMAIL_MAX_LENGTH, emailProblem } from '../../shared/utils/email'
import { isOrganizerShortName } from '../../shared/utils/organizer-short-name'
import { type Artist, IArtistClient } from '../services/artist-client'
import { IOrganizerClient, type Organizer } from '../services/organizer-client'
import {
	ARTIST_ALREADY_REPRESENTED,
	SHORT_NAME_IN_USE,
	toUserMessage,
} from './organizer-error-message'

/** Coarse lifecycle phase for the initial organizer-list fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

const EMPTY = '—'
/** Search queries shorter than this are not sent (mirrors the server minimum). */
const MIN_QUERY_LENGTH = 2
/** Debounce window for the artist-search input, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Flattened organizer view so the template renders without optional-chaining
 * noise. The raw {@link Organizer} is kept for identity comparisons on select.
 */
export interface OrganizerRow {
	readonly organizer: Organizer
	readonly id: string
	readonly name: string
	/** The short name that names the Organizer in console addresses. */
	readonly shortName: string
}

/** Flattened artist view for the represented-artists roster and search results. */
export interface ArtistRow {
	readonly id: string
	readonly name: string
}

function toOrganizerRow(organizer: Organizer): OrganizerRow {
	return {
		organizer,
		id: organizer.id?.value ?? '',
		name: organizer.name?.value ?? EMPTY,
		shortName: organizer.shortName?.value ?? EMPTY,
	}
}

function toArtistRow(artist: Artist): ArtistRow {
	return {
		id: artist.id?.value ?? '',
		name: artist.name?.value ?? EMPTY,
	}
}

/** Maximum length of an Organizer name (`OrganizerName` in the proto). */
const MAX_NAME_LENGTH = 200

/**
 * Checks the trimmed create-form values against the proto rules, so the admin
 * sees the problem before any request is sent. Returns null when valid.
 */
export function createFormError(
	name: string,
	shortName: string,
	ownerEmail: string,
): string | null {
	if (name.length === 0 || shortName.length === 0 || ownerEmail.length === 0) {
		return 'A name, a short name and an owner email are required.'
	}
	if ([...name].length > MAX_NAME_LENGTH) {
		return `The name must be ${MAX_NAME_LENGTH} characters or fewer.`
	}
	if (!isOrganizerShortName(shortName)) {
		return 'The short name must be 3 to 32 lowercase letters, digits or hyphens, start with a letter, and not be "admin" or "liverty-music".'
	}
	switch (emailProblem(ownerEmail)) {
		case 'tooLong':
			return `The owner email must be ${EMAIL_MAX_LENGTH} characters or fewer.`
		case 'invalid':
			return 'Enter a valid owner email address.'
		default:
			return null
	}
}

/**
 * Organizer-management screen for the admin console. It is the single surface
 * for the Organizer lifecycle: create an organizer (name, short name and owner
 * email),
 * list organizers, inspect a selected organizer and the artists it represents,
 * associate/disassociate artists (reusing the public consumer artist search),
 * and deactivate an organizer.
 *
 * A master-detail layout: the list + create form on the left, the selected
 * organizer's detail + roster on the right. The Organizer RPCs run against the
 * admin-local {@link IOrganizerClient}; artist search and the roster run against
 * {@link IArtistClient}. Errors are translated from
 * `ConnectError` codes into user-facing copy per section.
 */
export class OrganizersRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public organizers: OrganizerRow[] = []

	/** Create-form model + state. */
	public newName = ''
	public newShortName = ''
	public newOwnerEmail = ''
	public creating = false
	public createError = ''

	/** Currently selected organizer (right pane), or null when none is picked. */
	public selected: OrganizerRow | null = null
	public detailPhase: LoadPhase = 'ready'
	public detailError = ''
	public artists: ArtistRow[] = []

	/** Deactivate state for the selected organizer. */
	public deactivating = false
	public deactivateError = ''

	/** Artist-search state for the associate flow. */
	public searchQuery = ''
	public searching = false
	public searchError = ''
	public searchResults: ArtistRow[] = []
	/** Artist id whose associate request is in flight (disables its button). */
	public associatingId = ''
	public associateError = ''

	private searchTimer: ReturnType<typeof setTimeout> | null = null
	/** Aborts an in-flight search when a newer query supersedes it. */
	private searchAbort: AbortController | null = null

	private readonly client = resolve(IOrganizerClient)
	private readonly artistClient = resolve(IArtistClient)
	private readonly logger = resolve(ILogger).scopeTo('OrganizersRoute')

	public async attached(): Promise<void> {
		await this.load()
	}

	public detaching(): void {
		if (this.searchTimer !== null) clearTimeout(this.searchTimer)
		this.searchAbort?.abort()
	}

	public async load(): Promise<void> {
		this.phase = 'loading'
		this.loadError = ''
		try {
			const organizers = await this.client.list()
			this.organizers = organizers.map(toOrganizerRow)
			this.phase = 'ready'
		} catch (err) {
			this.loadError = toUserMessage(err, 'Failed to load organizers.')
			this.phase = 'error'
			this.logger.error('Failed to load organizers', err)
		}
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.organizers.length === 0
	}

	// --- Create -------------------------------------------------------------

	public async createOrganizer(): Promise<void> {
		if (this.creating) return
		const name = this.newName.trim()
		const shortName = this.newShortName.trim()
		const email = this.newOwnerEmail.trim()
		const invalid = createFormError(name, shortName, email)
		if (invalid) {
			this.createError = invalid
			return
		}
		this.creating = true
		this.createError = ''
		try {
			const created = await this.client.create(name, shortName, email)
			this.newName = ''
			this.newShortName = ''
			this.newOwnerEmail = ''
			if (created) {
				const row = toOrganizerRow(created)
				this.organizers.push(row)
				// Jump straight into the freshly created organizer's detail so the
				// admin can immediately start associating artists.
				await this.select(row)
			} else {
				await this.load()
			}
		} catch (err) {
			this.createError = toUserMessage(
				err,
				'Failed to create the organizer.',
				SHORT_NAME_IN_USE,
			)
			this.logger.error('Create organizer failed', err)
		} finally {
			this.creating = false
		}
	}

	// --- Selection + detail -------------------------------------------------

	public async select(row: OrganizerRow): Promise<void> {
		this.selected = row
		this.deactivateError = ''
		this.associateError = ''
		this.resetSearch()
		await this.loadArtists()
	}

	public isSelected(row: OrganizerRow): boolean {
		return this.selected?.id === row.id
	}

	private async loadArtists(): Promise<void> {
		const organizer = this.selected
		if (!organizer) return
		this.detailPhase = 'loading'
		this.detailError = ''
		try {
			const artists = await this.artistClient.listByOrganizer(organizer.id)
			this.artists = artists.map(toArtistRow)
			this.detailPhase = 'ready'
		} catch (err) {
			this.detailError = toUserMessage(err, 'Failed to load the roster.')
			this.detailPhase = 'error'
			this.logger.error('Failed to load organizer artists', err)
		}
	}

	// --- Deactivate ---------------------------------------------------------

	public async deactivate(): Promise<void> {
		const organizer = this.selected
		if (!organizer || this.deactivating) return
		this.deactivating = true
		this.deactivateError = ''
		try {
			await this.client.deactivate(organizer.id)
			// Deactivation frees associations server-side; refresh the roster so the
			// now-empty roster is reflected.
			await this.loadArtists()
		} catch (err) {
			this.deactivateError = toUserMessage(
				err,
				'Failed to deactivate the organizer.',
			)
			this.logger.error('Deactivate organizer failed', err)
		} finally {
			this.deactivating = false
		}
	}

	// --- Disassociate -------------------------------------------------------

	public async disassociate(artist: ArtistRow): Promise<void> {
		const organizer = this.selected
		if (!organizer) return
		this.associateError = ''
		try {
			await this.client.disassociateArtist(organizer.id, artist.id)
			const idx = this.artists.findIndex((a) => a.id === artist.id)
			if (idx !== -1) this.artists.splice(idx, 1)
		} catch (err) {
			this.associateError = toUserMessage(err, 'Failed to remove the artist.')
			this.logger.error('Disassociate artist failed', {
				artistId: artist.id,
				err,
			})
		}
	}

	// --- Associate via search ----------------------------------------------

	/** Debounces the search input; empty/too-short queries clear results. */
	public onSearchInput(): void {
		this.searchError = ''
		if (this.searchTimer !== null) clearTimeout(this.searchTimer)
		const query = this.searchQuery.trim()
		if (query.length < MIN_QUERY_LENGTH) {
			this.searchAbort?.abort()
			this.searchResults = []
			this.searching = false
			return
		}
		this.searchTimer = setTimeout(() => {
			void this.runSearch(query)
		}, SEARCH_DEBOUNCE_MS)
	}

	private async runSearch(query: string): Promise<void> {
		// Supersede any in-flight search so stale results never overwrite fresh ones.
		this.searchAbort?.abort()
		const abort = new AbortController()
		this.searchAbort = abort
		this.searching = true
		this.searchError = ''
		try {
			const results = await this.artistClient.search(query, abort.signal)
			if (abort.signal.aborted) return
			this.searchResults = results.map(toArtistRow)
		} catch (err) {
			if (abort.signal.aborted) return
			this.searchError = toUserMessage(err, 'Artist search failed.')
			this.logger.error('Artist search failed', { query, err })
		} finally {
			if (!abort.signal.aborted) this.searching = false
		}
	}

	public async associate(artist: ArtistRow): Promise<void> {
		const organizer = this.selected
		if (!organizer || this.associatingId !== '') return
		this.associatingId = artist.id
		this.associateError = ''
		try {
			await this.client.associateArtist(organizer.id, artist.id)
			// Reflect the new association in the roster without a round-trip, unless
			// it is somehow already present.
			if (!this.artists.some((a) => a.id === artist.id)) {
				this.artists.push(artist)
			}
			// Drop it from the results so it cannot be added twice.
			const idx = this.searchResults.findIndex((a) => a.id === artist.id)
			if (idx !== -1) this.searchResults.splice(idx, 1)
		} catch (err) {
			this.associateError = toUserMessage(
				err,
				'Failed to associate the artist.',
				ARTIST_ALREADY_REPRESENTED,
			)
			this.logger.error('Associate artist failed', {
				artistId: artist.id,
				err,
			})
		} finally {
			this.associatingId = ''
		}
	}

	public get hasSearchResults(): boolean {
		return this.searchResults.length > 0
	}

	private resetSearch(): void {
		if (this.searchTimer !== null) clearTimeout(this.searchTimer)
		this.searchAbort?.abort()
		this.searchQuery = ''
		this.searchResults = []
		this.searching = false
		this.searchError = ''
	}
}
