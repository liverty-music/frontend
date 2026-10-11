import type {
	ApproveResponse,
	DuplicateConflict,
	ExistingEvent,
	PendingConcert,
	ResolvedVenue,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/staged_concert/v1/staged_concert_service_pb.js'
import {
	Resolution,
	StagedConcertService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/staged_concert/v1/staged_concert_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type {
	ApproveResponse,
	DuplicateConflict,
	ExistingEvent,
	PendingConcert,
	ResolvedVenue,
}
export { Resolution }

export const IStagedConcertClient = DI.createInterface<IStagedConcertClient>(
	'IStagedConcertClient',
	(x) => x.singleton(StagedConcertClient),
)

export interface IStagedConcertClient extends StagedConcertClient {}

/**
 * Admin-local wrapper around the generated admin `StagedConcertService`
 * client: the review queue of discovered concerts (list/approve/reject).
 *
 * Built entirely from admin/shared modules — it never imports the consumer
 * `src/`. Callers work with the generated messages directly; the wrapper only
 * owns transport construction, request marshalling, logging, and error
 * surfacing.
 */
export class StagedConcertClient {
	private readonly logger = resolve(ILogger).scopeTo('StagedConcertClient')
	private readonly client = createClient(
		StagedConcertService,
		createAdminTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/** Returns every concert currently awaiting review. */
	public async list(signal?: AbortSignal): Promise<PendingConcert[]> {
		this.logger.info('Listing pending concerts')
		try {
			const response = await this.client.list({}, { signal })
			return response.pendingConcerts
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/**
	 * Publishes a pending concert to fans, or — when it duplicates an existing
	 * event and `resolution` is `UNSPECIFIED` — returns a response carrying a
	 * `conflict` without mutating state, so the caller can prompt the reviewer and
	 * re-call with `KEEP_EXISTING` or `ADOPT_STAGED`. Idempotent server-side.
	 */
	public async approve(
		stagedId: string,
		resolution: Resolution = Resolution.UNSPECIFIED,
		signal?: AbortSignal,
	): Promise<ApproveResponse> {
		this.logger.info('Approving concert', { stagedId, resolution })
		try {
			return await this.client.approve(
				{ stagedId: { value: stagedId }, resolution },
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
				{ stagedId: { value: stagedId }, reason },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('reject failed', { stagedId, error: err })
			throw err
		}
	}
}
