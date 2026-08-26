import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { OrganizerId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { OrganizerService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/organizer/v1/organizer_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export type { Artist, Organizer }

export const IOrganizerIdentityClient =
	DI.createInterface<IOrganizerIdentityClient>(
		'IOrganizerIdentityClient',
		(x) => x.singleton(OrganizerIdentityClient),
	)

export interface IOrganizerIdentityClient extends OrganizerIdentityClient {}

/**
 * Organizer-local wrapper around the generated organizer `OrganizerService`
 * client (Get + ListArtists). It is the console's identity bootstrap: the
 * console holds no `OrganizerId` before {@link get} (its only pre-call identity
 * is the Zitadel org the token is scoped to), so `get` yields the
 * `OrganizerId`, which {@link listArtists} then carries.
 *
 * Built entirely from organizer/shared modules via {@link createOrganizerTransport};
 * it never imports the consumer `src/` nor the sibling `admin/` bundle. Callers
 * pass plain strings; this wrapper owns wrapping them into the generated
 * message shells. Errors propagate to callers (screens translate `ConnectError`
 * codes into user-facing copy via {@link ./connect-error-copy}).
 */
export class OrganizerIdentityClient {
	private readonly logger = resolve(ILogger).scopeTo('OrganizerIdentityClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		OrganizerService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Returns the caller's own Organizer identity, resolved from the token. The
	 * sanctioned bootstrap call — the request carries no id.
	 */
	public async get(signal?: AbortSignal): Promise<Organizer | undefined> {
		this.logger.info('Getting own organizer')
		try {
			const response = await this.client.get({}, { signal })
			return response.organizer
		} catch (err) {
			this.logger.warn('get failed', { error: err })
			throw err
		}
	}

	/**
	 * Returns the artists the caller's own Organizer represents. `organizerId`
	 * is the caller's own id, obtained from {@link get}; any other value is
	 * rejected server-side with PERMISSION_DENIED.
	 */
	public async listArtists(
		organizerId: string,
		signal?: AbortSignal,
	): Promise<Artist[]> {
		this.logger.info('Listing represented artists', { organizerId })
		try {
			const response = await this.client.listArtists(
				{ organizerId: new OrganizerId({ value: organizerId }) },
				{ signal },
			)
			return response.artists
		} catch (err) {
			this.logger.warn('listArtists failed', { organizerId, error: err })
			throw err
		}
	}
}
