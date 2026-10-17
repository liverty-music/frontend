import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/artist/v1/artist_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export type { Artist }

export const IArtistClient = DI.createInterface<IArtistClient>(
	'IArtistClient',
	(x) => x.singleton(ArtistClient),
)

export interface IArtistClient extends ArtistClient {}

/**
 * Organizer-local wrapper around the generated organizer `ArtistService`
 * client. The caller's Organizer is resolved from the token, so no request
 * carries an organizer id.
 *
 * Built entirely from organizer/shared modules via {@link createOrganizerTransport};
 * it never imports the consumer `src/` nor the sibling `admin/` bundle. Errors
 * propagate to callers (screens translate `ConnectError` codes into
 * user-facing copy via {@link ./connect-error-copy}).
 */
export class ArtistClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistClient')
	private readonly client = createClient(
		ArtistService,
		createOrganizerTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	/** Returns the artists the caller's Organizer represents. */
	public async list(signal?: AbortSignal): Promise<Artist[]> {
		this.logger.info('Listing represented artists')
		try {
			const response = await this.client.list({}, { signal })
			return response.artists
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}
}
