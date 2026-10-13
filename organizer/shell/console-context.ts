import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import {
	loadLastArtistId,
	saveLastArtistId,
} from '../adapter/storage/last-artist-storage'
import { type ArtistScope, paths } from '../model/concert-model'
import { IArtistClient } from '../services/artist-client'
import { IOrganizerClient } from '../services/organizer-client'

/** The address parameters that place a screen (design D1). */
export interface ContextParams {
	readonly organizerId?: string
	readonly artistId?: string
}

/**
 * Whom the console is working for: the caller's Organizer (`OrganizerService.Get`),
 * the Artists it represents (`ArtistService.List`), and the Artist in the
 * current address. Every console link is built from here with `paths`, so a
 * link always names the Organizer and, below 公演, the Artist being worked on.
 *
 * The address is followed by {@link ConsoleContextHook} before each screen
 * loads. The Organizer id in an address is checked against the caller's own,
 * never used to read: the backend resolves the Organizer from the token.
 */
export class ConsoleContext {
	private readonly organizers = resolve(IOrganizerClient)
	private readonly artistClient = resolve(IArtistClient)
	private readonly logger = resolve(ILogger).scopeTo('ConsoleContext')

	/** The caller's own Organizer id; '' until it is read. */
	public ownOrganizerId = ''
	public organizerName = ''
	/** The represented Artists, by name. */
	public artists: Artist[] = []
	/** False when the represented Artists could not be read. */
	public artistsKnown = false
	/** The Organizer id in the current address ('' when it names none). */
	public addressOrganizerId = ''
	/** The Artist in the current address ('' when it names none). */
	public addressArtistId = ''
	/** The Artist last opened on this device. */
	private lastArtistId = ''
	private reading: Promise<void> | null = null

	/**
	 * Reads the Organizer and its Artists once. A failed Organizer read is not
	 * kept, so the next caller tries again; a failed Artist read leaves the
	 * Artists unknown.
	 */
	public load(): Promise<void> {
		this.reading ??= this.read().catch((err: unknown) => {
			this.reading = null
			throw err
		})
		return this.reading
	}

	private async read(): Promise<void> {
		const [organizer, artists] = await Promise.all([
			this.organizers.get(),
			this.artistClient.list().then(
				(list) => list,
				(err: unknown) => {
					this.logger.warn('Represented artists unavailable', err)
					return undefined
				},
			),
		])
		this.ownOrganizerId = organizer?.id?.value ?? ''
		this.organizerName = organizer?.name?.value ?? ''
		this.artistsKnown = artists !== undefined
		this.artists = [...(artists ?? [])].sort((a, b) =>
			nameOf(a).localeCompare(nameOf(b), 'ja'),
		)
		this.lastArtistId = this.ownOrganizerId
			? loadLastArtistId(this.ownOrganizerId)
			: ''
		// Unknown Artists are read again by the next caller.
		if (!this.artistsKnown) this.reading = null
	}

	/** True when the address names an Organizer other than the caller's. */
	public isOtherOrganizer(organizerId: string): boolean {
		return this.ownOrganizerId !== '' && organizerId !== this.ownOrganizerId
	}

	/** Follows the address of the screen about to show; remembers its Artist. */
	public follow(params: ContextParams): void {
		this.addressOrganizerId = params.organizerId ?? ''
		this.addressArtistId = params.artistId ?? ''
		if (this.addressArtistId && this.represents(this.addressArtistId)) {
			this.lastArtistId = this.addressArtistId
			saveLastArtistId(this.organizerId, this.addressArtistId)
		}
	}

	/** The Organizer every link names: the caller's, else the address's. */
	public get organizerId(): string {
		return this.ownOrganizerId || this.addressOrganizerId
	}

	/** True when the Organizer represents the Artist (or the Artists are unknown). */
	public represents(artistId: string): boolean {
		return (
			!this.artistsKnown || this.artists.some((a) => a.id?.value === artistId)
		)
	}

	/**
	 * The Artist being worked on: the one in the address, else the one last
	 * opened on this device, else the first represented Artist by name.
	 */
	public get artistId(): string {
		if (this.addressArtistId) return this.addressArtistId
		if (this.lastArtistId && this.represents(this.lastArtistId)) {
			return this.lastArtistId
		}
		return this.artists[0]?.id?.value ?? ''
	}

	public get artist(): Artist | undefined {
		const id = this.artistId
		return this.artists.find((a) => a.id?.value === id)
	}

	/** The scope of 公演 addresses: the Organizer and the Artist worked on. */
	public get scope(): ArtistScope {
		return { organizer: this.organizerId, artist: this.artistId }
	}

	/** The same scope for another Artist (a concert opened from Home). */
	public scopeOf(artistId: string): ArtistScope {
		return { organizer: this.organizerId, artist: artistId }
	}

	public get homeHref(): string {
		return paths.home(this.organizerId)
	}

	public get settingsHref(): string {
		return paths.settings(this.organizerId)
	}

	/** 公演: the Artist worked on, or the page saying none is represented. */
	public get concertsHref(): string {
		return this.artistId
			? paths.concerts(this.scope)
			: paths.artists(this.organizerId)
	}
}

function nameOf(artist: Artist): string {
	return artist.name?.value ?? ''
}

export const IConsoleContext = DI.createInterface<IConsoleContext>(
	'IConsoleContext',
	(x) => x.singleton(ConsoleContext),
)
export interface IConsoleContext extends ConsoleContext {}
