import { DI, ILogger, resolve } from 'aurelia'
import type { Artist } from '../entities/artist'
import type { GuestFollow } from '../state/app-state'
import { resolveStore } from '../state/store-interface'

export interface LocalFollowedArtist {
	id: string
	name: string
}

export const ILocalArtistClient = DI.createInterface<ILocalArtistClient>(
	'ILocalArtistClient',
	(x) => x.singleton(LocalArtistClient),
)

export interface ILocalArtistClient extends LocalArtistClient {}

/**
 * Thin facade over the Store for guest artist data.
 * Delegates all state reads/writes to IStore<AppState, AppAction>.
 */
export class LocalArtistClient {
	private readonly logger = resolve(ILogger).scopeTo('LocalArtistClient')
	private readonly store = resolveStore()

	public get followedCount(): number {
		return this.store.getState().guest.follows.length
	}

	/**
	 * List all locally followed artists.
	 */
	public listFollowed(): LocalFollowedArtist[] {
		return this.store.getState().guest.follows.map(toLocal)
	}

	/**
	 * Follow an artist locally via Store dispatch.
	 */
	public follow(artist: Artist): void {
		this.store.dispatch({ type: 'guest/follow', artist })
		this.logger.info('Local artist followed', {
			id: artist.id,
			name: artist.name,
		})
	}

	/**
	 * Unfollow an artist locally via Store dispatch.
	 */
	public unfollow(id: string): void {
		this.store.dispatch({ type: 'guest/unfollow', artistId: id })
		this.logger.info('Local artist unfollowed', { id })
	}

	/**
	 * Get the locally stored home area (ISO 3166-2 code).
	 */
	public getHome(): string | null {
		return this.store.getState().guest.home
	}

	/**
	 * Store the selected home area locally via Store dispatch.
	 */
	public setHome(home: string): void {
		this.store.dispatch({ type: 'guest/setUserHome', code: home })
		this.logger.info('Local home set', { home })
	}

	/**
	 * Clear all guest/local data via Store dispatch.
	 */
	public clearAll(): void {
		this.store.dispatch({ type: 'guest/clearAll' })
		this.logger.info('Local data cleared')
	}
}

function toLocal(f: GuestFollow): LocalFollowedArtist {
	return {
		id: f.artist.id,
		name: f.artist.name,
	}
}
