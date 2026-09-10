import { FollowService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/follow/v1/follow_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { FollowedArtist, Hype } from '../../../entities/follow'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { artistFrom } from '../mapper/artist-mapper'
import { hypeFrom, hypeTo } from '../mapper/follow-mapper'

export const IFollowRpcClient = DI.createInterface<IFollowRpcClient>(
	'IFollowRpcClient',
	(x) => x.singleton(FollowRpcClient),
)

export interface IFollowRpcClient extends FollowRpcClient {}

export class FollowRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('FollowRpcClient')
	private readonly client: Client<typeof FollowService>

	constructor() {
		this.logger.debug('Initializing FollowRpcClient')

		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)

		this.client = createClient(FollowService, transport)
	}

	public async follow(artistId: string): Promise<void> {
		await this.client.follow({
			artistId: { value: artistId },
		})
	}

	public async unfollow(artistId: string): Promise<void> {
		await this.client.unfollow({
			artistId: { value: artistId },
		})
	}

	public async listFollowed(signal?: AbortSignal): Promise<FollowedArtist[]> {
		const response = await this.client.listFollowed({}, { signal })
		return response.artists.flatMap((fa) => {
			if (!fa.artist) return []
			return [
				{
					artist: artistFrom(fa.artist),
					hype: hypeFrom(fa.hype),
				},
			]
		})
	}

	public async setHype(artistId: string, hype: Hype): Promise<void> {
		await this.client.setHype({
			artistId: { value: artistId },
			hype: hypeTo(hype),
		})
	}
}
