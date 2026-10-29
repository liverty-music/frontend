import { TicketSaleService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket_sale/v1/ticket_sale_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { EventTicketSales } from '../../../entities/ticket-sale'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { eventTicketSalesFrom } from '../mapper/ticket-sale-mapper'

export const ITicketSaleRpcClient = DI.createInterface<ITicketSaleRpcClient>(
	'ITicketSaleRpcClient',
	(x) => x.singleton(TicketSaleRpcClient),
)

export interface ITicketSaleRpcClient extends TicketSaleRpcClient {}

/** Fan-facing reads of an event's TicketSales. Needs no sign-in. */
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
	 * The event's sales ordered by start time, with the event's TicketStocks
	 * (seat type, price, state; never a count) and its per-account limit.
	 * No sale and no stock when the event has none.
	 */
	public async listByEvent(
		eventId: string,
		signal?: AbortSignal,
	): Promise<EventTicketSales> {
		try {
			const resp = await this.client.listByEvent(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return eventTicketSalesFrom(resp, eventId)
		} catch (err) {
			this.logger.warn('Ticket sale list failed', { eventId, error: err })
			throw err
		}
	}
}
