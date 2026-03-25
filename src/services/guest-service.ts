import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	clearHypes,
	loadFollows,
	loadHome,
	loadHypes,
	saveFollows,
	saveHome,
	saveHypes,
} from '../adapter/storage/guest-storage'
import { clearAllHelpSeen } from '../adapter/storage/onboarding-storage'
import { StorageKeys } from '../constants/storage-keys'
import type { Artist } from '../entities/artist'
import { type GuestFollow, hasFollow } from '../entities/follow'

export interface LocalFollowedArtist {
	id: string
	name: string
}

export const IGuestService = DI.createInterface<IGuestService>(
	'IGuestService',
	(x) => x.singleton(GuestService),
)

export interface IGuestService extends GuestService {}

/**
 * Singleton service owning all guest (unauthenticated) state.
 * Follows are mutated in-place (push/splice) for Aurelia array observation.
 * Home is persisted via @observable + homeChanged().
 */
export class GuestService {
	private readonly logger = resolve(ILogger).scopeTo('GuestService')

	public follows: GuestFollow[] = loadFollows()
	@observable public home: string | null = loadHome()
	private hypes: Record<string, string> = loadHypes()

	public get followedCount(): number {
		return this.follows.length
	}

	/**
	 * List all locally followed artists as a lightweight projection.
	 */
	public listFollowed(): LocalFollowedArtist[] {
		return this.follows.map((f) => ({
			id: f.artist.id,
			name: f.artist.name,
		}))
	}

	/**
	 * Follow an artist locally. No-op if already followed.
	 */
	public follow(artist: Artist): void {
		if (hasFollow(this.follows, artist.id)) return
		this.follows.push({ artist, home: null })
		this.persistFollows()
		this.logger.info('Local artist followed', {
			id: artist.id,
			name: artist.name,
		})
	}

	/**
	 * Unfollow an artist locally.
	 */
	public unfollow(id: string): void {
		const idx = this.follows.findIndex((f) => f.artist.id === id)
		if (idx >= 0) {
			this.follows.splice(idx, 1)
			this.persistFollows()
			this.logger.info('Local artist unfollowed', { id })
		}
	}

	/**
	 * Set the guest home area (ISO 3166-2 code).
	 */
	public setHome(code: string): void {
		this.home = code
		this.logger.info('Local home set', { home: code })
	}

	/**
	 * Set hype level for an artist (persisted to localStorage).
	 */
	public setHype(artistId: string, hype: string): void {
		this.hypes[artistId] = hype
		saveHypes(this.hypes)
		this.logger.info('Local hype set', { artistId, hype })
	}

	/**
	 * Get all stored guest hype levels.
	 */
	public getHypes(): Record<string, string> {
		return { ...this.hypes }
	}

	/**
	 * Clear all guest data.
	 */
	public clearAll(): void {
		this.follows.splice(0)
		this.persistFollows()
		this.home = null
		this.hypes = {}
		clearHypes()
		clearAllHelpSeen()
		localStorage.removeItem(StorageKeys.celebrationShown)
		this.logger.info('Local data cleared')
	}

	/**
	 * Persist home to localStorage on change.
	 */
	public homeChanged(newValue: string | null): void {
		saveHome(newValue)
	}

	private persistFollows(): void {
		saveFollows(this.follows)
	}
}
