import { batch, type ILogger } from 'aurelia'
import type { ArtistBubble } from '../../services/artist-service-client'
import type { BubblePool } from '../../services/bubble-pool'

export interface FollowClient {
	follow(artistId: string, artistName: string): Promise<void>
}

export interface FollowConcertClient {
	listConcerts(artistId: string): Promise<unknown[]>
}

export interface FollowCallbacks {
	onFollowed(artist: ArtistBubble): void
	onRollback(artist: ArtistBubble): void
	onHasUpcomingEvents(artistName: string): void
	onError(messageKey: string, params?: Record<string, string>): void
	respawnBubble(artist: ArtistBubble, position: { x: number; y: number }): void
}

export class FollowOrchestrator {
	public followedArtists: ArtistBubble[] = []

	constructor(
		private readonly followClient: FollowClient,
		private readonly concertClient: FollowConcertClient,
		private readonly pool: BubblePool,
		private readonly callbacks: FollowCallbacks,
		private readonly logger: ILogger,
		private readonly abortSignal: () => AbortSignal,
	) {}

	public get followedIds(): ReadonlySet<string> {
		return this.pool.followedIds
	}

	public get followedCount(): number {
		return this.followedArtists.length
	}

	public async followArtist(
		artist: ArtistBubble,
		spawnPosition?: { x: number; y: number },
	): Promise<void> {
		if (this.pool.isFollowed(artist.id)) return
		this.logger.info('Following artist', { artist: artist.name })

		// Optimistic UI update
		this.pool.markFollowed(artist.id)
		this.followedArtists = [...this.followedArtists, artist]

		try {
			await this.followClient.follow(artist.id, artist.name)
			this.logger.info('Artist followed', {
				followed: this.followedArtists.length,
			})
			this.callbacks.onFollowed(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})

			// Rollback optimistic update
			batch(() => {
				this.pool.unmarkFollowed(artist.id)
				this.pool.add([artist])
				this.followedArtists = this.followedArtists.filter(
					(b) => b.id !== artist.id,
				)
			})

			if (spawnPosition) {
				this.callbacks.respawnBubble(artist, spawnPosition)
			}

			this.callbacks.onError('discovery.followFailed', { name: artist.name })
			throw err
		}
	}

	public checkLiveEvents(artist: ArtistBubble): void {
		this.concertClient
			.listConcerts(artist.id)
			.then((concerts) => {
				if (this.abortSignal().aborted) return
				if (concerts.length > 0) {
					this.callbacks.onHasUpcomingEvents(artist.name)
				}
			})
			.catch((err) => {
				this.logger.warn('Failed to check live events', err)
			})
	}
}
