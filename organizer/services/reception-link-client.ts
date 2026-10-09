import type { ReceptionLink } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/reception_link_pb.js'
import { ReceptionLinkService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception_link/v1/reception_link_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export type { ReceptionLink }

export const IReceptionLinkClient = DI.createInterface<IReceptionLinkClient>(
	'IReceptionLinkClient',
	(x) => x.singleton(ReceptionLinkClient),
)

export interface IReceptionLinkClient extends ReceptionLinkClient {}

/**
 * Organizer-local wrapper around the generated `ReceptionLinkService`: the
 * signed-in operator issues, lists and revokes the reception links of their
 * own events. The caller's Organizer is resolved from the token. Errors
 * propagate to the screen, which translates `ConnectError` codes.
 */
export class ReceptionLinkClient {
	private readonly logger = resolve(ILogger).scopeTo('ReceptionLinkClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ReceptionLinkService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/** Every link of the event, by number; the token only on UNUSED links. */
	public async list(
		eventId: string,
		signal?: AbortSignal,
	): Promise<ReceptionLink[]> {
		try {
			const res = await this.client.list(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return res.receptionLinks
		} catch (err) {
			this.logger.warn('List failed', { eventId, error: err })
			throw err
		}
	}

	/** Issues the event's next numbered link, returned with its token. */
	public async issue(
		eventId: string,
		signal?: AbortSignal,
	): Promise<ReceptionLink> {
		this.logger.info('Issuing reception link', { eventId })
		try {
			const res = await this.client.issue(
				{ eventId: { value: eventId } },
				{ signal },
			)
			if (!res.receptionLink) throw new Error('Issue returned no link.')
			return res.receptionLink
		} catch (err) {
			this.logger.warn('Issue failed', { eventId, error: err })
			throw err
		}
	}

	/** Revokes a link at once and returns it. */
	public async revoke(
		linkId: string,
		signal?: AbortSignal,
	): Promise<ReceptionLink> {
		this.logger.info('Revoking reception link', { linkId })
		try {
			const res = await this.client.revoke(
				{ receptionLinkId: { value: linkId } },
				{ signal },
			)
			if (!res.receptionLink) throw new Error('Revoke returned no link.')
			return res.receptionLink
		} catch (err) {
			this.logger.warn('Revoke failed', { linkId, error: err })
			throw err
		}
	}
}
