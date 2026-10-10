import { ReservationService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/reservation/v1/reservation_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { HolderIdentity } from '../../../entities/holder-identity'
import type { Reservation } from '../../../entities/reservation'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { reservationFrom } from '../mapper/reservation-mapper'

export const IReservationRpcClient = DI.createInterface<IReservationRpcClient>(
	'IReservationRpcClient',
	(x) => x.singleton(ReservationRpcClient),
)

export interface IReservationRpcClient extends ReservationRpcClient {}

/**
 * The signed-in fan's first-come checkout. ConnectErrors propagate to the
 * caller, which tells the fan what happened.
 */
export class ReservationRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('ReservationRpcClient')
	private readonly client = createClient(
		ReservationService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Holds `count` tickets of the sale for 15 minutes, or resumes the fan's
	 * holding checkout when the count is the same.
	 */
	public async start(
		ticketSaleId: string,
		count: number,
		signal?: AbortSignal,
	): Promise<Reservation> {
		this.logger.info('Starting checkout', { ticketSaleId, count })
		const resp = await this.client.start(
			{ ticketSaleId: { value: ticketSaleId }, ticketCount: count },
			{ signal },
		)
		if (!resp.reservation) throw new Error('Start returned no reservation')
		return reservationFrom(resp.reservation)
	}

	/** The fan's checkout as it stands now. */
	public async get(
		reservationId: string,
		signal?: AbortSignal,
	): Promise<Reservation> {
		const resp = await this.client.get(
			{ reservationId: { value: reservationId } },
			{ signal },
		)
		if (!resp.reservation) throw new Error('Get returned no reservation')
		return reservationFrom(resp.reservation)
	}

	/**
	 * Records the 本人確認 details for the holding checkout and opens its card
	 * hold, returning the client secret the browser confirms with Stripe.
	 * Authorizing again returns the same hold.
	 */
	public async authorize(
		reservationId: string,
		identity: HolderIdentity,
		signal?: AbortSignal,
	): Promise<string> {
		this.logger.info('Authorizing checkout', { reservationId })
		const resp = await this.client.authorize(
			{
				reservationId: { value: reservationId },
				holderIdentity: {
					fullName: identity.fullName,
					phoneNumber: identity.phoneNumber,
				},
			},
			{ signal },
		)
		return resp.clientSecret
	}

	/**
	 * Places the order: commits the tickets, charges the card once and returns
	 * the issued Order's id. Placing it again returns the same Order.
	 */
	public async confirm(
		reservationId: string,
		signal?: AbortSignal,
	): Promise<string> {
		this.logger.info('Placing order', { reservationId })
		const resp = await this.client.confirm(
			{ reservationId: { value: reservationId } },
			{ signal },
		)
		return resp.order?.id?.value ?? ''
	}
}
