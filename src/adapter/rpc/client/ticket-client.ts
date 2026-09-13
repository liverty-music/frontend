import type { Order } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket/v1/ticket_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const ITicketRpcClient = DI.createInterface<ITicketRpcClient>(
	'ITicketRpcClient',
	(x) => x.singleton(TicketRpcClient),
)

export interface ITicketRpcClient extends TicketRpcClient {}

/**
 * TicketRpcClient is the fan-facing read surface over the caller's own Order
 * (payment result) and issued, account-bound covered tickets (⑤
 * ticket-purchase-and-issuance). Issuance itself is server-side (keyed on ④'s
 * captured win); this client only reads.
 */
export class TicketRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketRpcClient')
	private readonly client: Client<typeof TicketService>

	constructor() {
		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(TicketService, transport)
	}

	/**
	 * getOrder returns one of the caller's own Orders (its payment result).
	 * Throws a ConnectError with Code.NotFound when the order is not the
	 * caller's (non-revealing).
	 */
	public async getOrder(orderId: string, signal?: AbortSignal): Promise<Order> {
		this.logger.info('Getting order', { orderId })
		try {
			const response = await this.client.getOrder(
				{ orderId: { value: orderId } },
				{ signal },
			)
			if (!response.order) {
				throw new Error('GetOrder returned no order')
			}
			return response.order
		} catch (err) {
			this.logger.warn('GetOrder failed', { orderId, error: err })
			throw err
		}
	}

	/**
	 * getMyTickets returns all account-bound covered tickets issued to the
	 * caller. Empty when the caller has none.
	 */
	public async getMyTickets(signal?: AbortSignal): Promise<Ticket[]> {
		this.logger.info('Listing my tickets')
		try {
			const response = await this.client.getMyTickets({}, { signal })
			return response.tickets
		} catch (err) {
			this.logger.warn('GetMyTickets failed', { error: err })
			throw err
		}
	}
}
