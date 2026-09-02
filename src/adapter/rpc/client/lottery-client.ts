import {
	ApplicantIdentity,
	LotterySalesPhaseId,
	PaymentAuthorization,
	type TicketApplication,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { LotteryService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/lottery/v1/lottery_service_connect.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const ILotteryRpcClient = DI.createInterface<ILotteryRpcClient>(
	'ILotteryRpcClient',
	(x) => x.singleton(LotteryRpcClient),
)

export interface ILotteryRpcClient extends LotteryRpcClient {}

/**
 * Result of {@link LotteryRpcClient.createAuthorization}: the Stripe
 * client secret the frontend confirms with Elements (3DS once), plus the
 * provider PaymentIntent reference echoed back so the confirmed hold can be
 * carried into {@link LotteryRpcClient.apply}.
 */
export interface AuthorizationDraft {
	readonly clientSecret: string
	readonly paymentIntentRef: string
}

/** The 本人確認 (identity verification) the fan supplies at application time. */
export interface ApplicantIdentityInput {
	readonly fullName: string
	readonly phoneNumber: string
}

/**
 * Fan-facing lottery RPC client. Mirrors the transport/error-routing structure
 * of the other clients in this directory (auth is attached at the transport,
 * ConnectError propagates to the caller via the transport's error-router
 * interceptors — it is never swallowed here).
 *
 * This first increment exposes the full fan surface of `LotteryService`; the
 * apply flow (④) consumes `createAuthorization` + `apply`. `getMyApplication`,
 * `getResult`, and `withdrawApplication` are wired for the deferred
 * my-application / result / withdraw views.
 */
export class LotteryRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('LotteryRpcClient')
	private readonly client: Client<typeof LotteryService>

	constructor() {
		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(LotteryService, transport)
	}

	/**
	 * Starts the card hold: the server computes the amount
	 * (phase ticket_price × count) and creates a Stripe manual-capture
	 * PaymentIntent, returning the client secret the frontend confirms with
	 * Elements. No money is captured and no application is created yet.
	 */
	public async createAuthorization(
		phaseId: string,
		requestedTicketCount: number,
		signal?: AbortSignal,
	): Promise<AuthorizationDraft> {
		this.logger.info('Creating card authorization', {
			phaseId,
			requestedTicketCount,
		})
		const resp = await this.client.createAuthorization(
			{
				phaseId: new LotterySalesPhaseId({ value: phaseId }),
				requestedTicketCount,
			},
			{ signal },
		)
		return {
			clientSecret: resp.clientSecret,
			paymentIntentRef: resp.paymentIntentRef,
		}
	}

	/**
	 * Submits the application to an open phase with the confirmed card hold.
	 * `paymentIntentRef` is the confirmed PaymentIntent reference obtained by
	 * confirming the authorization with Stripe Elements.
	 */
	public async apply(
		phaseId: string,
		requestedTicketCount: number,
		identity: ApplicantIdentityInput,
		paymentIntentRef: string,
		signal?: AbortSignal,
	): Promise<TicketApplication | undefined> {
		this.logger.info('Submitting lottery application', {
			phaseId,
			requestedTicketCount,
		})
		const resp = await this.client.apply(
			{
				phaseId: new LotterySalesPhaseId({ value: phaseId }),
				requestedTicketCount,
				identity: new ApplicantIdentity({
					fullName: identity.fullName,
					phoneNumber: identity.phoneNumber,
				}),
				authorization: new PaymentAuthorization({ paymentIntentRef }),
			},
			{ signal },
		)
		return resp.application
	}

	/**
	 * Withdraws the caller's application before the draw, releasing the hold.
	 * TODO(lottery ⑤): consumed by the deferred withdraw UI.
	 */
	public async withdrawApplication(
		phaseId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Withdrawing lottery application', { phaseId })
		await this.client.withdrawApplication(
			{ phaseId: new LotterySalesPhaseId({ value: phaseId }) },
			{ signal },
		)
	}

	/**
	 * Returns the caller's own application for a phase in full.
	 * TODO(lottery ⑤): consumed by the deferred my-application view.
	 */
	public async getMyApplication(
		phaseId: string,
		signal?: AbortSignal,
	): Promise<TicketApplication | undefined> {
		const resp = await this.client.getMyApplication(
			{ phaseId: new LotterySalesPhaseId({ value: phaseId }) },
			{ signal },
		)
		return resp.application
	}

	/**
	 * Returns the caller's post-draw result for a phase.
	 * TODO(lottery ⑤): consumed by the deferred result view.
	 */
	public async getResult(
		phaseId: string,
		signal?: AbortSignal,
	): Promise<TicketApplication | undefined> {
		const resp = await this.client.getResult(
			{ phaseId: new LotterySalesPhaseId({ value: phaseId }) },
			{ signal },
		)
		return resp.application
	}
}
