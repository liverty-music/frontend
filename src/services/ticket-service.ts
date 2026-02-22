import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/ticket/v1/ticket_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const ITicketService = DI.createInterface<ITicketService>(
	'ITicketService',
	(x) => x.singleton(TicketServiceClient),
)

export interface ITicketService extends TicketServiceClient {}

export class TicketServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketService')
	private readonly authService = resolve(IAuthService)
	private readonly ticketClient = createClient(
		TicketService,
		createTransport(this.authService),
	)

	public async listTickets(signal?: AbortSignal): Promise<Ticket[]> {
		this.logger.info('Listing tickets for current user')
		try {
			const response = await this.ticketClient.listTickets({}, { signal })
			return response.tickets
		} catch (err) {
			this.logger.warn('Ticket list failed', { error: err })
			throw err
		}
	}
}
