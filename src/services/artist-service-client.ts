import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { DI, ILogger, resolve } from 'aurelia'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { IAuthService } from './auth-service'

export const IArtistServiceClient = DI.createInterface<IArtistServiceClient>(
	'IArtistServiceClient',
	(x) => x.singleton(ArtistServiceClient),
)

export interface IArtistServiceClient extends ArtistServiceClient {}

export class ArtistServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistServiceClient')
	private readonly authService = resolve(IAuthService)
	private readonly client: PromiseClient<typeof ArtistService>

	constructor() {
		this.logger.debug('Initializing ArtistServiceClient')

		const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

		// Create transport with authentication interceptor
		const transport = createConnectTransport({
			baseUrl,
			interceptors: [
				(next) => async (req) => {
					// Add Bearer token if user is authenticated
					if (this.authService.user?.access_token) {
						req.header.set(
							'Authorization',
							`Bearer ${this.authService.user.access_token}`,
						)
					}
					return await next(req)
				},
			],
		})

		this.client = createPromiseClient(ArtistService, transport)
	}

	public getClient(): PromiseClient<typeof ArtistService> {
		return this.client
	}
}
