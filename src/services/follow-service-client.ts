import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import { FollowService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/follow/v1/follow_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { FollowedArtist } from '../entities/follow'
import { resolveStore } from '../state/store-interface'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { IOnboardingService } from './onboarding-service'

export const IFollowServiceClient = DI.createInterface<IFollowServiceClient>(
	'IFollowServiceClient',
	(x) => x.singleton(FollowServiceClient),
)

export interface IFollowServiceClient extends FollowServiceClient {}

export class FollowServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('FollowServiceClient')
	private readonly store = resolveStore()
	private readonly onboarding = resolve(IOnboardingService)
	private readonly client: PromiseClient<typeof FollowService>

	constructor() {
		this.logger.debug('Initializing FollowServiceClient')

		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
		)

		this.client = createPromiseClient(FollowService, transport)
	}

	public getClient(): PromiseClient<typeof FollowService> {
		return this.client
	}

	/**
	 * Follow an artist. During onboarding, writes to guest store.
	 * Otherwise calls the backend RPC.
	 */
	public async follow(artistId: string, artistName: string): Promise<void> {
		if (this.onboarding.isOnboarding) {
			// During onboarding, find the artist in the guest store or create a minimal one
			const { Artist } = await import('../entities/artist')
			const artist = new Artist({
				id: { value: artistId },
				name: { value: artistName },
			})
			this.store.dispatch({ type: 'guest/follow', artist })
			return
		}
		await this.client.follow({
			artistId: new ArtistId({ value: artistId }),
		})
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
		await this.client.unfollow({
			artistId: new ArtistId({ value: artistId }),
		})
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
		const response = await this.client.listFollowed({}, { signal })
		return response.artists.flatMap((fa) => {
			if (!fa.artist) return []
			return [
				{
					artist: fa.artist,
					hype: hypeTypeToHype(fa.hype),
				},
			]
		})
	}
}

function hypeTypeToHype(hype: HypeType | undefined): FollowedArtist['hype'] {
	switch (hype) {
		case HypeType.WATCH:
			return 'watch'
		case HypeType.HOME:
			return 'home'
		case HypeType.NEARBY:
			return 'nearby'
		case HypeType.AWAY:
			return 'away'
		default:
			return 'watch'
	}
}
