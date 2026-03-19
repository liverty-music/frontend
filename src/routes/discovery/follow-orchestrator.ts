import { batch, type ILogger } from 'aurelia'
import type { Artist } from '../../entities/artist'
import type { BubblePool } from '../../services/bubble-pool'

export interface FollowClient {
	follow(artist: Artist): Promise<void>
}

export interface FollowConcertClient {
	listConcerts(artistId: string): Promise<unknown[]>
}

export interface FollowCallbacks {
	onFollowed(artist: Artist): void
	onRollback(artist: Artist): void
	onHasUpcomingEvents(artistName: string): void
	onError(messageKey: string, params?: Record<string, string>): void
	respawnBubble(artist: Artist, position: { x: number; y: number }): void
}

export class FollowOrchestrator {
	public followedArtists: Artist[] = []

	constructor(
		private readonly followClient: FollowClient,
		private readonly concertClient: FollowConcertClient,
		private readonly pool: BubblePool,
		private readonly callbacks: FollowCallbacks,
		private readonly logger: ILogger,
		private readonly abortSignal: () => AbortSignal,
	) {}

	public hydrate(artists: Artist[]): void {
		this.followedArtists = [...artists]
	}

	public get followedIds(): ReadonlySet<string> {
		return new Set(this.followedArtists.map((a) => a.id))
	}

	public get followedCount(): number {
		return this.followedArtists.length
	}

	public async followArtist(
		artist: Artist,
		spawnPosition?: { x: number; y: number },
	): Promise<void> {
		const artistId = artist.id
		const artistName = artist.name
		if (this.followedIds.has(artistId)) return
		this.logger.info('Following artist', { artist: artistName })

		// Optimistic UI update
		this.followedArtists = [...this.followedArtists, artist]
		this.pool.remove(artistId)

		try {
			await this.followClient.follow(artist)
			this.logger.info('Artist followed', {
				followed: this.followedArtists.length,
			})
			this.callbacks.onFollowed(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artistName,
				error: err,
			})

			// Rollback optimistic update
			batch(() => {
				this.followedArtists = this.followedArtists.filter(
					(a) => a.id !== artistId,
				)
				this.pool.add([artist])
			})

			if (spawnPosition) {
				this.callbacks.respawnBubble(artist, spawnPosition)
			}

			this.callbacks.onError('discovery.followFailed', { name: artistName })
			throw err
		}
	}

	public checkLiveEvents(artist: Artist): void {
		const artistId = artist.id
		const artistName = artist.name
		this.concertClient
			.listConcerts(artistId)
			.then((concerts) => {
				if (this.abortSignal().aborted) return
				if (concerts.length > 0) {
					this.callbacks.onHasUpcomingEvents(artistName)
				}
			})
			.catch((err) => {
				this.logger.warn('Failed to check live events', err)
			})
	}
}
