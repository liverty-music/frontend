import { VenueService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/venue/v1/venue_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

/** A place picked from the map catalog. */
export interface VenuePick {
	placeId: string
	name: string
	/** The place's short address (the catalog's secondary text), or '' when unknown. */
	address: string
}

export const IVenueClient = DI.createInterface<IVenueClient>(
	'IVenueClient',
	(x) => x.singleton(VenueClient),
)

export interface IVenueClient extends VenueClient {}

/**
 * Organizer-local wrapper around the generated `VenueService` client: finds up
 * to 5 places in the map catalog for the text the member is typing. Errors
 * propagate to callers (the venue field shows Unavailable with 再試行); an
 * aborted request (`signal`, when the text changed) rejects too, and the venue
 * field drops it.
 */
export class VenueClient {
	private readonly logger = resolve(ILogger).scopeTo('VenueClient')
	private readonly client = createClient(
		VenueService,
		createOrganizerTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	public async search(
		text: string,
		signal?: AbortSignal,
	): Promise<VenuePick[]> {
		try {
			const response = await this.client.search({ text }, { signal })
			return response.candidates.map((c) => ({
				placeId: c.placeId?.value ?? '',
				name: c.name?.value ?? '',
				address: c.address,
			}))
		} catch (err) {
			// An aborted request is the caller's choice, not a failure.
			if (!signal?.aborted) this.logger.warn('search failed', { error: err })
			throw err
		}
	}
}
