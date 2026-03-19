import { DI, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import type { Artist } from '../entities/artist'
import type { FollowedArtist, Hype } from '../entities/follow'
import { resolveStore } from '../state/store-interface'
import { IOnboardingService } from './onboarding-service'

export const IFollowServiceClient = DI.createInterface<IFollowServiceClient>(
	'IFollowServiceClient',
	(x) => x.singleton(FollowServiceClient),
)

export interface IFollowServiceClient extends FollowServiceClient {}

export class FollowServiceClient {
	private readonly store = resolveStore()
	private readonly onboarding = resolve(IOnboardingService)
	private readonly rpcClient = resolve(IFollowRpcClient)

	/**
	 * Follow an artist. During onboarding, writes to guest store.
	 * Otherwise calls the backend RPC.
	 */
	public async follow(artist: Artist): Promise<void> {
		if (this.onboarding.isOnboarding) {
			this.store.dispatch({ type: 'guest/follow', artist })
			return
		}
		await this.rpcClient.follow(artist.id)
	}

	/**
	 * Unfollow an artist. During onboarding, writes to guest store.
	 * Otherwise calls the backend RPC.
	 */
	public async unfollow(artistId: string): Promise<void> {
		if (this.onboarding.isOnboarding) {
			this.store.dispatch({ type: 'guest/unfollow', artistId })
			return
		}
		await this.rpcClient.unfollow(artistId)
	}

	/**
	 * List followed artists. During onboarding, reads from guest store.
	 * Otherwise calls the backend ListFollowed RPC.
	 */
	public async listFollowed(signal?: AbortSignal): Promise<FollowedArtist[]> {
		if (this.onboarding.isOnboarding) {
			return this.store.getState().guest.follows.map((f) => ({
				artist: f.artist,
				hype: 'away' as const,
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
