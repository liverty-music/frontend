import {
	ArtistId,
	HypeType,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { ILocalArtistClient } from './local-artist-client'
import { IOnboardingService } from './onboarding-service'

export interface ArtistBubble {
	id: string
	name: string
	mbid: string
	imageUrl: string
	x: number
	y: number
	radius: number
}

export interface FollowedArtistInfo {
	id: string
	name: string
	hype: HypeType
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
				hype: mapLocalHype(a.hype),
			}))
		}
		const response = await this.client.listFollowed({}, { signal })
		return response.artists.map((fa) => ({
			id: fa.artist?.id?.value ?? '',
			name: fa.artist?.name?.value ?? '',
			hype: fa.hype ?? HypeType.ANYWHERE,
		}))
	}

	/**
	 * Fetch top artists by country and optional genre tag.
	 */
	public async listTop(
		country: string,
		tag: string,
		limit: number,
	): Promise<ArtistBubble[]> {
		const resp = await this.client.listTop({ country, tag, limit })
		return resp.artists.map((a) => toBubble(a))
	}

	/**
	 * Fetch artists similar to the given artist.
	 */
	public async listSimilar(
		artistId: string,
		limit: number,
	): Promise<ArtistBubble[]> {
		const resp = await this.client.listSimilar({
			artistId: new ArtistId({ value: artistId }),
			limit,
		})
		return resp.artists.map((a) => toBubble(a))
	}

	/**
	 * Search artists by query string.
	 */
	public async search(query: string): Promise<ArtistBubble[]> {
		const resp = await this.client.search({ query })
		return resp.artists.map((a) => toBubble(a))
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

function mapLocalHype(level: 'WATCH' | 'HOME' | 'ANYWHERE'): HypeType {
	switch (level) {
		case 'WATCH':
			return HypeType.WATCH
		case 'HOME':
			return HypeType.HOME
		case 'ANYWHERE':
			return HypeType.ANYWHERE
		default:
			return HypeType.ANYWHERE
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
