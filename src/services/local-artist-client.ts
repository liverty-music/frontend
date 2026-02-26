import { DI, ILogger, resolve } from 'aurelia'

const FOLLOWED_ARTISTS_KEY = 'liverty:guest:followedArtists'
const REGION_KEY = 'liverty:guest:region'
const GUEST_KEY_PREFIX = 'liverty:guest:'

export interface LocalFollowedArtist {
	id: string
	name: string
	passionLevel: 'MUST_GO' | 'LOCAL_ONLY' | 'KEEP_AN_EYE'
}

export const ILocalArtistClient = DI.createInterface<ILocalArtistClient>(
	'ILocalArtistClient',
	(x) => x.singleton(LocalArtistClient),
)

export interface ILocalArtistClient extends LocalArtistClient {}

export class LocalArtistClient {
	private readonly logger = resolve(ILogger).scopeTo('LocalArtistClient')

	/**
	 * List all locally followed artists.
	 */
	public listFollowed(): LocalFollowedArtist[] {
		const raw = localStorage.getItem(FOLLOWED_ARTISTS_KEY)
		if (!raw) return []
		try {
			return JSON.parse(raw) as LocalFollowedArtist[]
		} catch {
			this.logger.warn(
				'Failed to parse local followed artists, returning empty',
			)
			return []
		}
	}

	/**
	 * Follow an artist locally.
	 */
	public follow(id: string, name: string): void {
		const artists = this.listFollowed()
		if (artists.some((a) => a.id === id)) {
			this.logger.debug('Artist already followed locally', { id })
			return
		}
		artists.push({ id, name, passionLevel: 'LOCAL_ONLY' })
		localStorage.setItem(FOLLOWED_ARTISTS_KEY, JSON.stringify(artists))
		this.logger.info('Local artist followed', {
			id,
			name,
			count: artists.length,
		})
	}

	/**
	 * Unfollow an artist locally.
	 */
	public unfollow(id: string): void {
		const artists = this.listFollowed()
		const filtered = artists.filter((a) => a.id !== id)
		if (filtered.length === artists.length) {
			this.logger.debug('Artist not found locally for unfollow', { id })
			return
		}
		localStorage.setItem(FOLLOWED_ARTISTS_KEY, JSON.stringify(filtered))
		this.logger.info('Local artist unfollowed', { id })
	}

	/**
	 * Set the passion level for a locally followed artist.
	 */
	public setPassionLevel(
		artistId: string,
		level: LocalFollowedArtist['passionLevel'],
	): void {
		const artists = this.listFollowed()
		const artist = artists.find((a) => a.id === artistId)
		if (!artist) {
			this.logger.warn('Cannot set passion level: artist not found locally', {
				artistId,
			})
			return
		}
		artist.passionLevel = level
		localStorage.setItem(FOLLOWED_ARTISTS_KEY, JSON.stringify(artists))
		this.logger.info('Local passion level set', { artistId, level })
	}

	/**
	 * Get the locally stored region.
	 */
	public getRegion(): string | null {
		return localStorage.getItem(REGION_KEY)
	}

	/**
	 * Store the selected region locally.
	 */
	public setRegion(region: string): void {
		localStorage.setItem(REGION_KEY, region)
		this.logger.info('Local region set', { region })
	}

	/**
	 * Get the count of locally followed artists.
	 */
	public get followedCount(): number {
		return this.listFollowed().length
	}

	/**
	 * Clear all guest/local data from LocalStorage.
	 */
	public clearAll(): void {
		const keysToRemove: string[] = []
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (key?.startsWith(GUEST_KEY_PREFIX)) {
				keysToRemove.push(key)
			}
		}
		for (const key of keysToRemove) {
			localStorage.removeItem(key)
		}
		this.logger.info('Local data cleared', { keysRemoved: keysToRemove.length })
	}
}
