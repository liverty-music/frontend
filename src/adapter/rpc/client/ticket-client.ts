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
 * TicketRpcClient is the fan-facing read surface over the caller's issued,
 * account-bound covered tickets. Issuance itself is server-side; this client
 * only reads. The caller's Orders are read with `OrderRpcClient`.
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
	 * getMyTickets returns all account-bound covered tickets issued to the
	 * caller. Empty when the caller has none.
	 */
	public async getMyTickets(signal?: AbortSignal): Promise<Ticket[]> {
		this.logger.info('Listing my tickets')
		try {
			const response = await this.client.list({}, { signal })
			return response.tickets
		} catch (err) {
			this.logger.warn('List failed', { error: err })
			throw err
		}
	}
}
