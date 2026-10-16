import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { OrganizerService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/organizer/v1/organizer_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Artist, Organizer }

/**
 * The Organizer's five 特商法 business details as plain strings. The whole set
 * is sent on every update: the server replaces them together.
 */
export interface BusinessDetailsInput {
	readonly legalName: string
	readonly representativeName: string
	readonly businessAddress: string
	/** The business phone number in E.164 form. */
	readonly businessPhoneNumber: string
	readonly contactEmail: string
}

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
 * / `OrganizerShortName` / `Email` / business-detail message shells the request fields require.
 * An Organizer's artists are read with `ArtistClient.listByOrganizer`.
 *
 * All RPCs are served by the admin Connect server, so it reuses the same
 * {@link createAdminTransport} host (`adminApiBaseUrl`) as the concert client.
 */
export class OrganizerClient {
	private readonly logger = resolve(ILogger).scopeTo('OrganizerClient')
	private readonly authService = resolve(IAuthService)
	private readonly transport = createAdminTransport(
		this.authService,
		resolve(ILogger).scopeTo('AdminTransport'),
		resolve(IAppConfig),
	)
	private readonly client = createClient(OrganizerService, this.transport)

	/**
	 * Registers a new organizer under its short name, inviting the owner email
	 * as its owner. The owner email may also be a fan account's.
	 */
	public async create(
		name: string,
		shortName: string,
		ownerEmail: string,
		signal?: AbortSignal,
	): Promise<Organizer | undefined> {
		this.logger.info('Creating organizer', { name, shortName })
		try {
			const response = await this.client.create(
				{
					name: { value: name },
					shortName: { value: shortName },
					ownerEmail: { value: ownerEmail },
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
				{ organizerId: { value: organizerId } },
				{ signal },
			)
			return response.organizer
		} catch (err) {
			this.logger.warn('get failed', { organizerId, error: err })
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
					organizerId: { value: organizerId },
					artistId: { value: artistId },
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
					organizerId: { value: organizerId },
					artistId: { value: artistId },
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
				{ organizerId: { value: organizerId } },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('deactivate failed', { organizerId, error: err })
			throw err
		}
	}

	/**
	 * Records the organizer's 特商法 business details, replacing any previous
	 * set, and returns the organizer with the stored details.
	 */
	public async setBusinessDetails(
		organizerId: string,
		details: BusinessDetailsInput,
		signal?: AbortSignal,
	): Promise<Organizer | undefined> {
		this.logger.info('Setting business details', { organizerId })
		try {
			const response = await this.client.setBusinessDetails(
				{
					organizerId: { value: organizerId },
					legalName: { value: details.legalName },
					representativeName: { value: details.representativeName },
					businessAddress: { value: details.businessAddress },
					businessPhoneNumber: { value: details.businessPhoneNumber },
					contactEmail: { value: details.contactEmail },
				},
				{ signal },
			)
			return response.organizer
		} catch (err) {
			this.logger.warn('setBusinessDetails failed', {
				organizerId,
				error: err,
			})
			throw err
		}
	}

	/**
	 * Sets the platform fee rate (basis points, 0 to 3000) applied to the
	 * organizer's future orders and returns the organizer with the stored rate.
	 */
	public async setPlatformFeeRate(
		organizerId: string,
		platformFeeRateBps: number,
		signal?: AbortSignal,
	): Promise<Organizer | undefined> {
		this.logger.info('Setting platform fee rate', {
			organizerId,
			platformFeeRateBps,
		})
		try {
			const response = await this.client.setPlatformFeeRate(
				{ organizerId: { value: organizerId }, platformFeeRateBps },
				{ signal },
			)
			return response.organizer
		} catch (err) {
			this.logger.warn('setPlatformFeeRate failed', {
				organizerId,
				platformFeeRateBps,
				error: err,
			})
			throw err
		}
	}
}
