import type {
	ApproveResponse,
	ConcertCandidate,
	DuplicateConflict,
	ExistingEvent,
	ResolvedVenue,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/concert_candidate/v1/concert_candidate_service_pb.js'
import {
	ConcertCandidateService,
	Resolution,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/concert_candidate/v1/concert_candidate_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type {
	ApproveResponse,
	ConcertCandidate,
	DuplicateConflict,
	ExistingEvent,
	ResolvedVenue,
}
export { Resolution }

export const IConcertCandidateClient =
	DI.createInterface<IConcertCandidateClient>('IConcertCandidateClient', (x) =>
		x.singleton(ConcertCandidateClient),
	)

export interface IConcertCandidateClient extends ConcertCandidateClient {}

/**
 * Admin-local wrapper around the generated admin `ConcertCandidateService`
 * client: the review queue of discovered concerts (list/approve/reject).
 *
 * Built entirely from admin/shared modules — it never imports the consumer
 * `src/`. Callers work with the generated messages directly; the wrapper only
 * owns transport construction, request marshalling, logging, and error
 * surfacing.
 */
export class ConcertCandidateClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertCandidateClient')
	private readonly client = createClient(
		ConcertCandidateService,
		createAdminTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/** Returns every concert currently awaiting review. */
	public async list(signal?: AbortSignal): Promise<ConcertCandidate[]> {
		this.logger.info('Listing pending concerts')
		try {
			const response = await this.client.list({}, { signal })
			return response.concertCandidates
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/**
	 * Publishes a pending concert to fans, or — when it duplicates an existing
	 * event and `resolution` is `UNSPECIFIED` — returns a response carrying a
	 * `conflict` without mutating state, so the caller can prompt the reviewer and
	 * re-call with `KEEP_EXISTING` or `ADOPT_STAGED` (adopt the concert
	 * candidate). Idempotent server-side.
	 */
	public async approve(
		concertCandidateId: string,
		resolution: Resolution = Resolution.UNSPECIFIED,
		signal?: AbortSignal,
	): Promise<ApproveResponse> {
		this.logger.info('Approving concert', { concertCandidateId, resolution })
		try {
			return await this.client.approve(
				{ concertCandidateId: { value: concertCandidateId }, resolution },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('approve failed', { concertCandidateId, error: err })
			throw err
		}
	}

	/** Drops a pending concert, recording the reviewer's reason. */
	public async reject(
		concertCandidateId: string,
		reason: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Rejecting concert', { concertCandidateId })
		try {
			await this.client.reject(
				{ concertCandidateId: { value: concertCandidateId }, reason },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('reject failed', { concertCandidateId, error: err })
			throw err
		}
	}
}
