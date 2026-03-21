import { DI, resolve } from 'aurelia'
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
	private readonly authService = resolve(IAuthService)
	private readonly guest = resolve(IGuestService)
	private readonly rpcClient = resolve(IFollowRpcClient)

	/**
	 * Follow an artist. Unauthenticated users write to guest service.
	 * Authenticated users call the backend RPC.
	 */
	public async follow(artist: Artist): Promise<void> {
		if (!this.authService.isAuthenticated) {
			this.guest.follow(artist)
			return
		}
		await this.rpcClient.follow(artist.id)
	}

	/**
	 * Unfollow an artist. Unauthenticated users write to guest service.
	 * Authenticated users call the backend RPC.
	 */
	public async unfollow(artistId: string): Promise<void> {
		if (!this.authService.isAuthenticated) {
			this.guest.unfollow(artistId)
			return
		}
		await this.rpcClient.unfollow(artistId)
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
