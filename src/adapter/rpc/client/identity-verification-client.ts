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
 * Connect client for `IdentityVerificationService` (identity-ekyc-jpki). Wraps
 * the generated proto request/response types and maps them to/from the domain
 * shapes at the boundary, mirroring `TicketJourneyRpcClient`. Auth is applied at
 * the transport, not per call.
 *
 * NOTE: the backend currently returns UNAVAILABLE for StartVerify /
 * CompleteVerify (also stubbed pending Pocket Sign onboarding — Section 0), so
 * only `getMyVerificationStatus` returns a real result (UNVERIFIED) today.
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
	 * Open a verification attempt; returns the challenge (Nonce) the Pocket Sign
	 * Verify SDK signs against the card, plus the session id echoed back on
	 * completion.
	 *
	 * NOTE: backend-stubbed → currently rejects with UNAVAILABLE.
	 */
	public async startVerify(
		userId: string,
		method: VerificationMethod,
		signal?: AbortSignal,
	): Promise<{ sessionId: string; challenge: Uint8Array }> {
		this.logger.info('Starting verification', { method })
		try {
			const response = await this.client.startVerify(
				{
					userId: new UserId({ value: userId }),
					method: verificationMethodTo(method),
				},
				{ signal },
			)
			return {
				sessionId: response.sessionId,
				challenge: response.challenge,
			}
		} catch (err) {
			this.logger.warn('StartVerify failed', { method, error: err })
			throw err
		}
	}

	/**
	 * Submit the SDK-signed response for validation. On success the account
	 * becomes IDENTITY_VERIFIED and the backing identity is returned.
	 *
	 * NOTE: backend-stubbed → currently rejects with UNAVAILABLE.
	 */
	public async completeVerify(
		userId: string,
		sessionId: string,
		signedResponse: Uint8Array,
		signal?: AbortSignal,
	): Promise<MyVerificationStatus> {
		this.logger.info('Completing verification', { sessionId })
		try {
			const response = await this.client.completeVerify(
				{
					userId: new UserId({ value: userId }),
					sessionId,
					signedResponse,
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
