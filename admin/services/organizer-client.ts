import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import {
	OrganizerId,
	OrganizerName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { UserEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { OrganizerService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/admin/organizer/v1/organizer_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Artist, Organizer }

export const IOrganizerClient = DI.createInterface<IOrganizerClient>(
	'IOrganizerClient',
	(x) => x.singleton(OrganizerClient),
)

export interface IOrganizerClient extends OrganizerClient {}

/**
 * Admin-local wrapper around the generated admin `OrganizerService` client.
 *
 * Mirrors {@link ConcertClient}: a DI-registered interface, a logger-scoped
 * instance, one method per RPC with request marshalling + per-call logging, and
 * errors propagated to the caller (routes translate `ConnectError` codes into
 * user-facing copy). It is built entirely from admin/shared modules and never
 * imports the consumer `src/`. Callers pass plain strings; this wrapper owns
 * wrapping them into the generated `OrganizerId` / `ArtistId` / `OrganizerName`
 * / `UserEmail` message shells the request fields require.
 *
 * All RPCs are served by the admin Connect server, so it reuses the same
 * {@link createAdminTransport} host (`adminApiBaseUrl`) as the concert client.
 */
export class OrganizerClient {
	private readonly logger = resolve(ILogger).scopeTo('OrganizerClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		OrganizerService,
		createAdminTransport(
			this.authService,
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/** Registers a new organizer, seeding its initial operator as the owner. */
	public async create(
		name: string,
		operatorEmail: string,
		signal?: AbortSignal,
	): Promise<Organizer | undefined> {
		this.logger.info('Creating organizer', { name })
		try {
			const response = await this.client.create(
				{
					name: new OrganizerName({ value: name }),
					operatorEmail: new UserEmail({ value: operatorEmail }),
				},
				{ signal },
			)
			return response.organizer
		} catch (err) {
			this.logger.warn('create failed', { name, error: err })
			throw err
		}
	}

	/** Returns every organizer in catalog order. */
	public async list(signal?: AbortSignal): Promise<Organizer[]> {
		this.logger.info('Listing organizers')
		try {
			const response = await this.client.list({}, { signal })
			return response.organizers
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/** Returns a single organizer by id. */
	public async get(
		organizerId: string,
		signal?: AbortSignal,
	): Promise<Organizer | undefined> {
		this.logger.info('Getting organizer', { organizerId })
		try {
			const response = await this.client.get(
				{ organizerId: new OrganizerId({ value: organizerId }) },
				{ signal },
			)
			return response.organizer
		} catch (err) {
			this.logger.warn('get failed', { organizerId, error: err })
			throw err
		}
	}

	/** Returns the artists the organizer currently represents. */
	public async listArtists(
		organizerId: string,
		signal?: AbortSignal,
	): Promise<Artist[]> {
		this.logger.info('Listing organizer artists', { organizerId })
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

	/** Links an existing artist to the organizer (at most one organizer per artist). */
	public async associateArtist(
		organizerId: string,
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Associating artist', { organizerId, artistId })
		try {
			await this.client.associateArtist(
				{
					organizerId: new OrganizerId({ value: organizerId }),
					artistId: new ArtistId({ value: artistId }),
				},
				{ signal },
			)
		} catch (err) {
			this.logger.warn('associateArtist failed', {
				organizerId,
				artistId,
				error: err,
			})
			throw err
		}
	}

	/** Unlinks an artist from the organizer. Idempotent server-side. */
	public async disassociateArtist(
		organizerId: string,
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Disassociating artist', { organizerId, artistId })
		try {
			await this.client.disassociateArtist(
				{
					organizerId: new OrganizerId({ value: organizerId }),
					artistId: new ArtistId({ value: artistId }),
				},
				{ signal },
			)
		} catch (err) {
			this.logger.warn('disassociateArtist failed', {
				organizerId,
				artistId,
				error: err,
			})
			throw err
		}
	}

	/** Turns an organizer off; frees its artist associations. Idempotent server-side. */
	public async deactivate(
		organizerId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Deactivating organizer', { organizerId })
		try {
			await this.client.deactivate(
				{ organizerId: new OrganizerId({ value: organizerId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('deactivate failed', { organizerId, error: err })
			throw err
		}
	}
}
