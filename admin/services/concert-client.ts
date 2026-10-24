import { ConcertService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/concert/v1/concert_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import {
	type ResolvedConcert,
	resolveConcerts,
} from '../../shared/lib/concert/resolve-concert'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { ResolvedConcert }

export const IConcertClient = DI.createInterface<IConcertClient>(
	'IConcertClient',
	(x) => x.singleton(ConcertClient),
)

export interface IConcertClient extends ConcertClient {}

/**
 * Admin-local wrapper around the generated admin `ConcertService` client.
 *
 * Mirrors the shape of the consumer's `ConcertRpcClient` (DI-registered
 * interface, logger-scoped, error propagation) but is built entirely from
 * admin/shared modules — it never imports the consumer `src/`. It covers
 * published-catalog management (list, one artist's concerts, delete); the pending-review queue is on
 * `ConcertCandidateClient`. The wrapper only owns transport construction, request
 * marshalling, logging, and error surfacing.
 */
export class ConcertClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ConcertService,
		createAdminTransport(
			this.authService,
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Returns every published concert for catalog review and management, each
	 * resolved against the Series and Artists the response carries once.
	 */
	public async list(signal?: AbortSignal): Promise<ResolvedConcert[]> {
		this.logger.info('Listing published concerts')
		try {
			const response = await this.client.list({}, { signal })
			return resolveConcerts(response)
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/**
	 * Returns every published concert one artist performs in, CANCELLED and
	 * UNLISTED included, oldest first, resolved like {@link list}.
	 */
	public async listByArtist(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ResolvedConcert[]> {
		this.logger.info("Listing an artist's concerts", { artistId })
		try {
			const response = await this.client.listByArtist(
				{ artistId: { value: artistId } },
				{ signal },
			)
			return resolveConcerts(response)
		} catch (err) {
			this.logger.warn('listByArtist failed', { artistId, error: err })
			throw err
		}
	}

	/**
	 * Permanently deletes a concert by its event id with the records that
	 * depend only on it. Fails with FailedPrecondition while a purchase of the
	 * event is still live.
	 */
	public async delete(eventId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Deleting concert', { eventId })
		try {
			await this.client.delete({ eventId: { value: eventId } }, { signal })
		} catch (err) {
			this.logger.warn('delete failed', { eventId, error: err })
			throw err
		}
	}
}
