import { KycService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/kyc/v1/kyc_service_pb.js'
import {
	type Client,
	Code,
	ConnectError,
	createClient,
} from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { Kyc, KycStatus, VerificationMethod } from '../../../entities/kyc'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import {
	kycFrom,
	verificationLevelFrom,
	verificationMethodTo,
} from '../mapper/kyc-mapper'

export const IKycRpcClient = DI.createInterface<IKycRpcClient>(
	'IKycRpcClient',
	(x) => x.singleton(KycRpcClient),
)

export interface IKycRpcClient extends KycRpcClient {}

/**
 * Connect client for `KycService` (identity-ekyc-jpki, PocketSign Stamp
 * redirect flow). Wraps the generated proto request/response types and maps
 * them to/from the domain shapes at the boundary, mirroring
 * `TicketJourneyRpcClient`. Auth is applied at the transport, not per call, and
 * no request names the fan: the backend acts for the signed-in caller.
 *
 * NOTE: the backend returns UNAVAILABLE for Start / Create until PocketSign
 * onboarding completes. `get` works and answers NotFound for a fan who never
 * passed KYC.
 */
export class KycRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('KycRpcClient')
	private readonly client: Client<typeof KycService>

	public constructor() {
		const transport = createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(KycService, transport)
	}

	/**
	 * The caller's Kyc (`KycService.Get`), or `undefined` when the fan never
	 * passed KYC (the server answers NotFound).
	 */
	public async get(signal?: AbortSignal): Promise<Kyc | undefined> {
		this.logger.info('Getting the caller Kyc')
		try {
			const response = await this.client.get({}, { signal })
			return kycFrom(response.kyc)
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.NotFound) {
				return undefined
			}
			this.logger.warn('Get failed', { error: err })
			throw err
		}
	}

	/**
	 * Open a PocketSign Stamp session (`KycService.Start`). Returns the session
	 * id (to persist until the callback arrives) and the redirect URL to open in
	 * the PocketSign app. The client MUST navigate to `redirectUrl` immediately
	 * after persisting the `sessionId`; the card is read in the PocketSign app,
	 * not here.
	 */
	public async start(
		method: VerificationMethod,
		signal?: AbortSignal,
	): Promise<{ sessionId: string; redirectUrl: string }> {
		this.logger.info('Starting KYC (Stamp session)', { method })
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
	 * Finalize the Stamp session (`KycService.Create`). The backend retrieves
	 * the signed result from Pocket Sign by `session_id` and, on success,
	 * records the fan's Kyc and makes the account KYC_VERIFIED.
	 */
	public async create(
		sessionId: string,
		signal?: AbortSignal,
	): Promise<KycStatus> {
		this.logger.info('Creating Kyc (Stamp finalize)', { sessionId })
		try {
			const response = await this.client.create({ sessionId }, { signal })
			return {
				level: verificationLevelFrom(response.verificationLevel),
				kyc: kycFrom(response.kyc),
			}
		} catch (err) {
			this.logger.warn('Create failed', { sessionId, error: err })
			throw err
		}
	}
}
