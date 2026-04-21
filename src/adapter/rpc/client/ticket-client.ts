import { UserId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { TicketService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/ticket/v1/ticket_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { Ticket } from '../../../entities/ticket'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { ticketFrom } from '../mapper/ticket-mapper'

export const ITicketRpcClient = DI.createInterface<ITicketRpcClient>(
	'ITicketRpcClient',
	(x) => x.singleton(TicketRpcClient),
)

export interface ITicketRpcClient extends TicketRpcClient {}

export class TicketRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketService')
	private readonly ticketClient = createClient(
		TicketService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
		),
	)

	public async listTickets(
		userId: string,
		signal?: AbortSignal,
	): Promise<Ticket[]> {
		this.logger.info('Listing tickets for current user')
		try {
			const response = await this.ticketClient.listTickets(
				{ userId: new UserId({ value: userId }) },
				{ signal },
			)
			return response.tickets.map(ticketFrom)
		} catch (err) {
			this.logger.warn('Ticket list failed', { error: err })
			throw err
		}
	}
}
