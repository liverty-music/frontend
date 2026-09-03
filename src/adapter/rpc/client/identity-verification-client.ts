import { UserId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { IdentityVerificationService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/identity/v1/identity_verification_service_connect.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type {
	MyVerificationStatus,
	VerificationMethod,
} from '../../../entities/verified-identity'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import {
	verificationLevelFrom,
	verificationMethodTo,
	verifiedIdentityFrom,
} from '../mapper/verified-identity-mapper'

export const IIdentityVerificationRpcClient =
	DI.createInterface<IIdentityVerificationRpcClient>(
		'IIdentityVerificationRpcClient',
		(x) => x.singleton(IdentityVerificationRpcClient),
	)

export interface IIdentityVerificationRpcClient
	extends IdentityVerificationRpcClient {}

/**
 * Connect client for `IdentityVerificationService` (identity-ekyc-jpki,
 * schema v0.60.0 — PocketSign Stamp redirect flow). Wraps the generated proto
 * request/response types and maps them to/from the domain shapes at the
 * boundary, mirroring `TicketJourneyRpcClient`. Auth is applied at the
 * transport, not per call.
 *
 * v0.60.0 changes:
 * - `startVerify` now returns `{ sessionId, redirectUrl }` (Url wrapper, not
 *   a `challenge: Uint8Array`). The client navigates to `redirectUrl` and the
 *   card is read in the PocketSign app — not in our app.
 * - `completeVerify` no longer accepts a `signedResponse` (reserved field 3);
 *   the backend finalizes by `session_id` only.
 *
 * NOTE: the backend returns UNAVAILABLE for StartVerify / CompleteVerify until
 * PocketSign onboarding (Section 0) completes. `getMyVerificationStatus` works
 * and returns UNVERIFIED for new accounts.
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

	/** Read the caller's current verification level + backing identity. */
	public async getMyVerificationStatus(
		userId: string,
		signal?: AbortSignal,
	): Promise<MyVerificationStatus> {
		this.logger.info('Getting my verification status')
		try {
			const response = await this.client.getMyVerificationStatus(
				{ userId: new UserId({ value: userId }) },
				{ signal },
			)
			return {
				level: verificationLevelFrom(response.verificationLevel),
				identity: verifiedIdentityFrom(response.verifiedIdentity),
			}
		} catch (err) {
			this.logger.warn('GetMyVerificationStatus failed', { error: err })
			throw err
		}
	}

	/**
	 * Open a PocketSign Stamp session. Returns the session id (to persist until
	 * the callback arrives) and the redirect URL to open in the PocketSign app.
	 * The client MUST navigate to `redirectUrl` immediately after persisting the
	 * `sessionId`; the card is read in the PocketSign app, not here.
	 *
	 * NOTE: backend returns UNAVAILABLE until PocketSign onboarding completes.
	 */
	public async startVerify(
		userId: string,
		method: VerificationMethod,
		signal?: AbortSignal,
	): Promise<{ sessionId: string; redirectUrl: string }> {
		this.logger.info('Starting verification (Stamp session)', { method })
		try {
			const response = await this.client.startVerify(
				{
					userId: new UserId({ value: userId }),
					method: verificationMethodTo(method),
				},
				{ signal },
			)
			const redirectUrl = response.redirectUrl?.value
			if (!redirectUrl) {
				throw new Error(
					'StartVerify: server returned a StartVerifyResponse without a redirect_url',
				)
			}
			return {
				sessionId: response.sessionId,
				redirectUrl,
			}
		} catch (err) {
			this.logger.warn('StartVerify failed', { method, error: err })
			throw err
		}
	}

	/**
	 * Finalize the Stamp session. The backend retrieves the signed result from
	 * Pocket Sign by `session_id` (no signed payload from the client — the card
	 * was read in the PocketSign app). On success the account becomes
	 * IDENTITY_VERIFIED and the backing identity is returned.
	 *
	 * NOTE: backend returns UNAVAILABLE until PocketSign onboarding completes.
	 */
	public async completeVerify(
		userId: string,
		sessionId: string,
		signal?: AbortSignal,
	): Promise<MyVerificationStatus> {
		this.logger.info('Completing verification (Stamp finalize)', { sessionId })
		try {
			const response = await this.client.completeVerify(
				{
					userId: new UserId({ value: userId }),
					sessionId,
				},
				{ signal },
			)
			return {
				level: verificationLevelFrom(response.verificationLevel),
				identity: verifiedIdentityFrom(response.verifiedIdentity),
			}
		} catch (err) {
			this.logger.warn('CompleteVerify failed', { sessionId, error: err })
			throw err
		}
	}
}
