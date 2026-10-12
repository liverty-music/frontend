import { IdentityVerificationService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/identity_verification/v1/identity_verification_service_pb.js'
import {
	type Client,
	Code,
	ConnectError,
	createClient,
} from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type {
	IdentityVerification,
	VerificationMethod,
} from '../../../entities/identity-verification'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import {
	identityVerificationFrom,
	verificationMethodTo,
} from '../mapper/identity-verification-mapper'

export const IIdentityVerificationRpcClient =
	DI.createInterface<IIdentityVerificationRpcClient>(
		'IIdentityVerificationRpcClient',
		(x) => x.singleton(IdentityVerificationRpcClient),
	)

export interface IIdentityVerificationRpcClient
	extends IdentityVerificationRpcClient {}

/**
 * Connect client for `IdentityVerificationService` (identity-ekyc-jpki,
 * PocketSign Stamp redirect flow). Wraps the generated proto request/response
 * types and maps them to/from the domain shapes at the boundary, mirroring
 * `TicketJourneyRpcClient`. Auth is applied at the transport, not per call, and
 * no request names the fan: the backend acts for the signed-in caller.
 *
 * NOTE: the backend returns UNAVAILABLE for Start / Create until PocketSign
 * onboarding completes. `get` works and answers NotFound for a fan who never
 * verified.
 */
export class IdentityVerificationRpcClient {
	private readonly logger = resolve(ILogger).scopeTo(
		'IdentityVerificationRpcClient',
	)
	private readonly client: Client<typeof IdentityVerificationService>

	public constructor() {
		const transport = createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(IdentityVerificationService, transport)
	}

	/**
	 * The caller's IdentityVerification (`IdentityVerificationService.Get`), or
	 * `undefined` when the fan never verified (the server answers NotFound).
	 */
	public async get(
		signal?: AbortSignal,
	): Promise<IdentityVerification | undefined> {
		this.logger.info('Getting the caller IdentityVerification')
		try {
			const response = await this.client.get({}, { signal })
			return identityVerificationFrom(response.identityVerification)
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.NotFound) {
				return undefined
			}
			this.logger.warn('Get failed', { error: err })
			throw err
		}
	}

	/**
	 * Open a PocketSign Stamp session (`IdentityVerificationService.Start`). Returns the session
	 * id (to persist until the callback arrives) and the redirect URL to open in
	 * the PocketSign app. The client MUST navigate to `redirectUrl` immediately
	 * after persisting the `sessionId`; the card is read in the PocketSign app,
	 * not here.
	 */
	public async start(
		method: VerificationMethod,
		signal?: AbortSignal,
	): Promise<{ sessionId: string; redirectUrl: string }> {
		this.logger.info('Starting identity verification (Stamp session)', {
			method,
		})
		try {
			const response = await this.client.start(
				{ method: verificationMethodTo(method) },
				{ signal },
			)
			const redirectUrl = response.redirectUrl?.value
			if (!redirectUrl) {
				throw new Error(
					'Start: server returned a StartResponse without a redirect_url',
				)
			}
			return { sessionId: response.sessionId, redirectUrl }
		} catch (err) {
			this.logger.warn('Start failed', { method, error: err })
			throw err
		}
	}

	/**
	 * Finalize the Stamp session (`IdentityVerificationService.Create`). The
	 * backend retrieves the signed result from Pocket Sign by `session_id` and,
	 * on success, records the fan's IdentityVerification and returns it.
	 */
	public async create(
		sessionId: string,
		signal?: AbortSignal,
	): Promise<IdentityVerification | undefined> {
		this.logger.info('Creating IdentityVerification (Stamp finalize)', {
			sessionId,
		})
		try {
			const response = await this.client.create({ sessionId }, { signal })
			return identityVerificationFrom(response.identityVerification)
		} catch (err) {
			this.logger.warn('Create failed', { sessionId, error: err })
			throw err
		}
	}
}
