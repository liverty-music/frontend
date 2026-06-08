import { StagedConcertId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/staged_concert_pb.js'
import type {
	PendingConcert,
	ResolvedVenue,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/v1/concert_moderation_service_pb.js'
import { ConcertModerationService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/admin/v1/concert_moderation_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { PendingConcert, ResolvedVenue }

export const IConcertModerationClient =
	DI.createInterface<IConcertModerationClient>(
		'IConcertModerationClient',
		(x) => x.singleton(ConcertModerationClient),
	)

export interface IConcertModerationClient extends ConcertModerationClient {}

/**
 * Admin-local wrapper around the generated `ConcertModerationService` client.
 *
 * Mirrors the shape of the consumer's `ConcertRpcClient` (DI-registered
 * interface, logger-scoped, error propagation) but is built entirely from
 * admin/shared modules — it never imports the consumer `src/`. Callers work
 * with the generated `PendingConcert` messages directly; the wrapper only owns
 * transport construction, request marshalling, logging, and error surfacing.
 */
export class ConcertModerationClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertModerationClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ConcertModerationService,
		createAdminTransport(
			this.authService,
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/** Returns every concert currently awaiting review. */
	public async listPending(signal?: AbortSignal): Promise<PendingConcert[]> {
		this.logger.info('Listing pending concerts')
		try {
			const response = await this.client.listPendingConcerts({}, { signal })
			return response.pendingConcerts
		} catch (err) {
			this.logger.warn('listPendingConcerts failed', { error: err })
			throw err
		}
	}

	/** Publishes a pending concert to fans. Idempotent server-side. */
	public async approve(stagedId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Approving concert', { stagedId })
		try {
			await this.client.approveConcert(
				{ stagedId: new StagedConcertId({ value: stagedId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('approveConcert failed', { stagedId, error: err })
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
			await this.client.rejectConcert(
				{ stagedId: new StagedConcertId({ value: stagedId }), reason },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('rejectConcert failed', { stagedId, error: err })
			throw err
		}
	}
}
