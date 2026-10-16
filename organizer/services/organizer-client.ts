import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { OrganizerService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/v1/organizer_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import {
	createOrganizerPublicTransport,
	createOrganizerTransport,
} from './organizer-transport'

export type { Organizer }

export const IOrganizerClient = DI.createInterface<IOrganizerClient>(
	'IOrganizerClient',
	(x) => x.singleton(OrganizerClient),
)

export interface IOrganizerClient extends OrganizerClient {}

/**
 * Organizer-local wrapper around the generated organizer `OrganizerService`
 * client (Get, SendSignInLinks). It is the console's bootstrap: the console holds no
 * `OrganizerId` before {@link get} (before the call it knows only the Zitadel
 * org the token is scoped to), so `get` yields the caller's Organizer. The
 * represented artists are read from `ArtistService.List` (see
 * {@link ./artist-client}).
 *
 * Built entirely from organizer/shared modules via {@link createOrganizerTransport};
 * it never imports the consumer `src/` nor the sibling `admin/` bundle. Callers
 * pass plain strings; this wrapper owns wrapping them into the generated
 * message shells. Errors propagate to callers (screens translate `ConnectError`
 * codes into user-facing copy via {@link ./connect-error-copy}).
 */
export class OrganizerClient {
	private readonly logger = resolve(ILogger).scopeTo('OrganizerClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		OrganizerService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/** SendSignInLinks needs no sign-in: it goes out without a token. */
	private readonly publicClient = createClient(
		OrganizerService,
		createOrganizerPublicTransport(
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Asks for a sign-in link for each Organizer `email` owns. The answer is
	 * the same whether or not the address owns any; it fails with
	 * InvalidArgument for a malformed address and ResourceExhausted when this
	 * client asked too often.
	 */
	public async sendSignInLinks(
		email: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Sending sign-in links')
		try {
			await this.publicClient.sendSignInLinks(
				{ email: { value: email } },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('sendSignInLinks failed', { error: err })
			throw err
		}
	}

	/**
	 * Returns the caller's own Organizer, resolved from the token. The
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
}
