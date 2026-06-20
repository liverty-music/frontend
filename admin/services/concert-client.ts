import { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { EventId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { StagedConcertId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/staged_concert_pb.js'
import type {
	PendingConcert,
	ResolvedVenue,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_service_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/admin/v1/concert_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Concert, PendingConcert, ResolvedVenue }

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
 * admin/shared modules — it never imports the consumer `src/`. It covers the
 * full admin concert surface: the pending-review queue (list/approve/reject)
 * plus published-catalog management (list/delete). Callers work with the
 * generated messages directly; the wrapper only owns transport construction,
 * request marshalling, logging, and error surfacing.
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

	/** Returns every published concert for catalog review and management. */
	public async list(signal?: AbortSignal): Promise<Concert[]> {
		this.logger.info('Listing published concerts')
		try {
			const response = await this.client.list({}, { signal })
			return response.concerts
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/** Permanently deletes a published concert by its event id (cascades server-side). */
	public async delete(eventId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Deleting concert', { eventId })
		try {
			await this.client.delete(
				{ eventId: new EventId({ value: eventId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('delete failed', { eventId, error: err })
			throw err
		}
	}

	/** Returns every concert currently awaiting review. */
	public async listPending(signal?: AbortSignal): Promise<PendingConcert[]> {
		this.logger.info('Listing pending concerts')
		try {
			const response = await this.client.listPending({}, { signal })
			return response.pendingConcerts
		} catch (err) {
			this.logger.warn('listPending failed', { error: err })
			throw err
		}
	}

	/** Publishes a pending concert to fans. Idempotent server-side. */
	public async approve(stagedId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Approving concert', { stagedId })
		try {
			await this.client.approve(
				{ stagedId: new StagedConcertId({ value: stagedId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('approve failed', { stagedId, error: err })
			throw err
		}
	}

	/** Drops a pending concert, recording the reviewer's reason. */
	public async reject(
		stagedId: string,
		reason: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Rejecting concert', { stagedId })
		try {
			await this.client.reject(
				{ stagedId: new StagedConcertId({ value: stagedId }), reason },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('reject failed', { stagedId, error: err })
			throw err
		}
	}
}
