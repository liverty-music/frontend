import { DI, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import type { Artist } from '../entities/artist'
import type { FollowedArtist, Hype } from '../entities/follow'
import { IGuestService } from './guest-service'
import { IOnboardingService } from './onboarding-service'

export const IFollowServiceClient = DI.createInterface<IFollowServiceClient>(
	'IFollowServiceClient',
	(x) => x.singleton(FollowServiceClient),
)

export interface IFollowServiceClient extends FollowServiceClient {}

export class FollowServiceClient {
	private readonly guest = resolve(IGuestService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly rpcClient = resolve(IFollowRpcClient)

	/**
	 * Follow an artist. During onboarding, writes to guest service.
	 * Otherwise calls the backend RPC.
	 */
	public async follow(artist: Artist): Promise<void> {
		if (this.onboarding.isOnboarding) {
			this.guest.follow(artist)
			return
		}
		await this.rpcClient.follow(artist.id)
	}

	/**
	 * Unfollow an artist. During onboarding, writes to guest service.
	 * Otherwise calls the backend RPC.
	 */
	public async unfollow(artistId: string): Promise<void> {
		if (this.onboarding.isOnboarding) {
			this.guest.unfollow(artistId)
			return
		}
		await this.rpcClient.unfollow(artistId)
	}

	/**
	 * List followed artists. During onboarding, reads from guest service.
	 * Otherwise calls the backend ListFollowed RPC.
	 */
	public async listFollowed(signal?: AbortSignal): Promise<FollowedArtist[]> {
		if (this.onboarding.isOnboarding) {
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
