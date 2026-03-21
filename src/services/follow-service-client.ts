import { DI, ILogger, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import type { Artist } from '../entities/artist'
import type { FollowedArtist, Hype } from '../entities/follow'
import { IAuthService } from './auth-service'
import { IGuestService } from './guest-service'

export const IFollowServiceClient = DI.createInterface<IFollowServiceClient>(
	'IFollowServiceClient',
	(x) => x.singleton(FollowServiceClient),
)

export interface IFollowServiceClient extends FollowServiceClient {}

export class FollowServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('FollowService')
	private readonly authService = resolve(IAuthService)
	private readonly guest = resolve(IGuestService)
	private readonly rpcClient = resolve(IFollowRpcClient)

	public followedArtists: Artist[] = []

	public get followedIds(): ReadonlySet<string> {
		return new Set(this.followedArtists.map((a) => a.id))
	}

	public get followedCount(): number {
		return this.followedArtists.length
	}

	/**
	 * Hydrate follow state from persisted guest follows (onboarding page-load).
	 */
	public hydrate(artists: Artist[]): void {
		this.followedArtists = [...artists]
	}

	/**
	 * Follow an artist with optimistic UI update.
	 * Guest users delegate to GuestService for localStorage persistence.
	 * Authenticated users call backend RPC with rollback on failure.
	 */
	public async follow(artist: Artist): Promise<void> {
		if (this.followedIds.has(artist.id)) return
		this.logger.info('Following artist', { artist: artist.name })

		// Optimistic update
		const prev = this.followedArtists
		this.followedArtists = [...prev, artist]

		if (!this.authService.isAuthenticated) {
			this.guest.follow(artist)
			this.logger.info('Artist followed (guest)', {
				followed: this.followedCount,
			})
			return
		}

		try {
			await this.rpcClient.follow(artist.id)
			this.logger.info('Artist followed', {
				followed: this.followedCount,
			})
		} catch (err) {
			// Rollback
			this.followedArtists = prev
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})
			throw err
		}
	}

	/**
	 * Unfollow an artist. Unauthenticated users write to guest service.
	 * Authenticated users call the backend RPC.
	 */
	public async unfollow(artistId: string): Promise<void> {
		if (!this.authService.isAuthenticated) {
			this.guest.unfollow(artistId)
			this.followedArtists = this.followedArtists.filter(
				(a) => a.id !== artistId,
			)
			return
		}
		await this.rpcClient.unfollow(artistId)
		this.followedArtists = this.followedArtists.filter((a) => a.id !== artistId)
	}

	/**
	 * List followed artists. Unauthenticated users read from guest service.
	 * Authenticated users call the backend ListFollowed RPC.
	 */
	public async listFollowed(signal?: AbortSignal): Promise<FollowedArtist[]> {
		if (!this.authService.isAuthenticated) {
			return this.guest.follows.map((f) => ({
				artist: f.artist,
				hype: 'watch' as const,
			}))
		}
		return this.rpcClient.listFollowed(signal)
	}

	/**
	 * Set the hype level for a followed artist.
	 */
	public async setHype(artistId: string, hype: Hype): Promise<void> {
		await this.rpcClient.setHype(artistId, hype)
	}
}
