import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import { FollowService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/follow/v1/follow_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { ArtistBubble } from './artist-service-client'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { ILocalArtistClient } from './local-artist-client'
import { IOnboardingService } from './onboarding-service'

export interface FollowedArtistInfo {
	id: string
	name: string
	hype: HypeType
}

export const IFollowServiceClient = DI.createInterface<IFollowServiceClient>(
	'IFollowServiceClient',
	(x) => x.singleton(FollowServiceClient),
)

export interface IFollowServiceClient extends FollowServiceClient {}

export class FollowServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('FollowServiceClient')
	private readonly localClient = resolve(ILocalArtistClient)
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
	 * Follow an artist. During onboarding, writes to LocalArtistClient.
	 * Otherwise calls the backend RPC.
	 */
	public async follow(artistId: string, artistName: string): Promise<void> {
		if (this.onboarding.isOnboarding) {
			this.localClient.follow(artistId, artistName)
			return
		}
		await this.client.follow({
			artistId: new ArtistId({ value: artistId }),
		})
	}

	/**
	 * Unfollow an artist. During onboarding, writes to LocalArtistClient.
	 * Otherwise calls the backend RPC.
	 */
	public async unfollow(artistId: string): Promise<void> {
		if (this.onboarding.isOnboarding) {
			this.localClient.unfollow(artistId)
			return
		}
		await this.client.unfollow({
			artistId: new ArtistId({ value: artistId }),
		})
	}

	/**
	 * List followed artists. During onboarding, reads from LocalArtistClient.
	 * Otherwise calls the backend ListFollowed RPC.
	 */
	public async listFollowed(
		signal?: AbortSignal,
	): Promise<FollowedArtistInfo[]> {
		if (this.onboarding.isOnboarding) {
			return this.localClient.listFollowed().map((a) => ({
				id: a.id,
				name: a.name,
				hype: mapLocalHype(a.hype),
			}))
		}
		const response = await this.client.listFollowed({}, { signal })
		return response.artists.map((fa) => ({
			id: fa.artist?.id?.value ?? '',
			name: fa.artist?.name?.value ?? '',
			hype: fa.hype ?? HypeType.AWAY,
		}))
	}

	/**
	 * Fetch followed artists directly from the backend (bypasses onboarding check).
	 * Used by loading sequence to verify backend state.
	 */
	public async listFollowedAsBubbles(
		signal?: AbortSignal,
	): Promise<ArtistBubble[]> {
		const resp = await this.client.listFollowed({}, { signal })
		return resp.artists.flatMap((fa) =>
			fa.artist ? [toBubble(fa.artist)] : [],
		)
	}
}

function mapLocalHype(level: 'WATCH' | 'HOME' | 'NEARBY' | 'AWAY'): HypeType {
	switch (level) {
		case 'WATCH':
			return HypeType.WATCH
		case 'HOME':
			return HypeType.HOME
		case 'NEARBY':
			return HypeType.NEARBY
		case 'AWAY':
			return HypeType.AWAY
		default:
			return HypeType.AWAY
	}
}

function toBubble(artist: {
	id?: { value: string }
	name?: { value: string }
	mbid?: { value: string }
}): ArtistBubble {
	const id = artist.id?.value ?? ''
	const name = artist.name?.value ?? ''
	const mbid = artist.mbid?.value ?? ''
	return {
		id: id || mbid || crypto.randomUUID(),
		name,
		mbid,
		imageUrl: '',
		x: 0,
		y: 0,
		radius: 30 + Math.random() * 15,
	}
}
