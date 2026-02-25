import {
	ArtistId,
	PassionLevel,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { ILocalArtistClient } from './local-artist-client'
import { IOnboardingService } from './onboarding-service'

export interface FollowedArtistInfo {
	id: string
	name: string
	passionLevel: PassionLevel
}

export const IArtistServiceClient = DI.createInterface<IArtistServiceClient>(
	'IArtistServiceClient',
	(x) => x.singleton(ArtistServiceClient),
)

export interface IArtistServiceClient extends ArtistServiceClient {}

export class ArtistServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistServiceClient')
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly client: PromiseClient<typeof ArtistService>

	constructor() {
		this.logger.debug('Initializing ArtistServiceClient')

		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
		)

		this.client = createPromiseClient(ArtistService, transport)
	}

	public getClient(): PromiseClient<typeof ArtistService> {
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
				passionLevel: mapLocalPassionLevel(a.passionLevel),
			}))
		}
		const response = await this.client.listFollowed({}, { signal })
		return response.artists.map((fa) => ({
			id: fa.artist?.id?.value ?? '',
			name: fa.artist?.name?.value ?? '',
			passionLevel: fa.passionLevel ?? PassionLevel.LOCAL_ONLY,
		}))
	}
}

function mapLocalPassionLevel(
	level: 'MUST_GO' | 'LOCAL_ONLY' | 'KEEP_AN_EYE',
): PassionLevel {
	switch (level) {
		case 'MUST_GO':
			return PassionLevel.MUST_GO
		case 'LOCAL_ONLY':
			return PassionLevel.LOCAL_ONLY
		case 'KEEP_AN_EYE':
			return PassionLevel.KEEP_AN_EYE
		default:
			return PassionLevel.LOCAL_ONLY
	}
}
