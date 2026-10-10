import { TicketSaleService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket_sale/v1/ticket_sale_service_pb.js'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { TicketSale } from '../../../entities/ticket-sale'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { ticketSaleFrom } from '../mapper/ticket-sale-mapper'

export const ITicketSaleRpcClient = DI.createInterface<ITicketSaleRpcClient>(
	'ITicketSaleRpcClient',
	(x) => x.singleton(TicketSaleRpcClient),
)

export interface ITicketSaleRpcClient extends TicketSaleRpcClient {}

/** Fan-facing reads of an event's first-come TicketSale. Needs no sign-in. */
export class TicketSaleRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketSaleRpcClient')
	private readonly client = createClient(
		TicketSaleService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * The event's sale with its state now, or null when the event has no sale
	 * or its concert is not published (both NotFound). Other errors reject.
	 */
	public async get(
		eventId: string,
		signal?: AbortSignal,
	): Promise<TicketSale | null> {
		try {
			const resp = await this.client.get(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return resp.ticketSale ? ticketSaleFrom(resp.ticketSale) : null
		} catch (err) {
			if (ConnectError.from(err).code === Code.NotFound) return null
			this.logger.warn('Ticket sale get failed', { eventId, error: err })
			throw err
		}
	}
}
