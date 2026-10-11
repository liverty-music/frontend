import { CheckoutService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/checkout/v1/checkout_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { Checkout } from '../../../entities/checkout'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { checkoutFrom } from '../mapper/checkout-mapper'

export const ICheckoutRpcClient = DI.createInterface<ICheckoutRpcClient>(
	'ICheckoutRpcClient',
	(x) => x.singleton(CheckoutRpcClient),
)

export interface ICheckoutRpcClient extends CheckoutRpcClient {}

/**
 * The signed-in fan's first-come checkout (`CheckoutService`). The fan is the
 * caller; no request names them. ConnectErrors propagate to the caller, which
 * tells the fan what happened.
 */
export class CheckoutRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('CheckoutRpcClient')
	private readonly client = createClient(
		CheckoutService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Holds `count` tickets of the TicketType for 15 minutes, or resumes the
	 * fan's holding checkout when the count is the same.
	 */
	public async start(
		ticketTypeId: string,
		count: number,
		signal?: AbortSignal,
	): Promise<Checkout> {
		this.logger.info('Starting checkout', { ticketTypeId, count })
		const resp = await this.client.start(
			{ ticketTypeId: { value: ticketTypeId }, ticketCount: count },
			{ signal },
		)
		if (!resp.checkout) throw new Error('Start returned no checkout')
		return checkoutFrom(resp.checkout)
	}

	/** The fan's checkout as it stands now. */
	public async get(
		checkoutId: string,
		signal?: AbortSignal,
	): Promise<Checkout> {
		const resp = await this.client.get(
			{ checkoutId: { value: checkoutId } },
			{ signal },
		)
		if (!resp.checkout) throw new Error('Get returned no checkout')
		return checkoutFrom(resp.checkout)
	}

	/**
	 * Saves the full name and phone number on the fan's account and opens the
	 * held checkout's card authorization, returning the card authorization
	 * secret the browser confirms with the payment provider. Authorizing again
	 * returns the same card authorization.
	 */
	public async authorizeCard(
		checkoutId: string,
		fullName: string,
		phoneNumber: string,
		signal?: AbortSignal,
	): Promise<string> {
		this.logger.info('Authorizing card for checkout', { checkoutId })
		const resp = await this.client.authorizeCard(
			{
				checkoutId: { value: checkoutId },
				fullName: { value: fullName },
				phoneNumber: { value: phoneNumber },
			},
			{ signal },
		)
		const secret = resp.cardAuthorizationSecret?.value
		if (!secret) {
			throw new Error('AuthorizeCard returned no card authorization secret')
		}
		return secret
	}

	/**
	 * Places the order: commits the tickets, charges the card once and returns
	 * the issued Order's id. Placing it again returns the same Order.
	 */
	public async confirm(
		checkoutId: string,
		signal?: AbortSignal,
	): Promise<string> {
		this.logger.info('Placing order', { checkoutId })
		const resp = await this.client.confirm(
			{ checkoutId: { value: checkoutId } },
			{ signal },
		)
		return resp.order?.id?.value ?? ''
	}
}
