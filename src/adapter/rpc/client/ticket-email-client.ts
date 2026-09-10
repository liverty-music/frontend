import { TicketEmailService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket_email/v1/ticket_email_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { JourneyStatus } from '../../../entities/concert'
import type {
	TicketEmail,
	TicketEmailType,
} from '../../../entities/ticket-email'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { emailTypeTo, ticketEmailFrom } from '../mapper/ticket-email-mapper'
import { journeyStatusTo } from '../mapper/ticket-journey-mapper'

export const ITicketEmailRpcClient = DI.createInterface<ITicketEmailRpcClient>(
	'ITicketEmailRpcClient',
	(x) => x.singleton(TicketEmailRpcClient),
)

export interface ITicketEmailRpcClient extends TicketEmailRpcClient {}

/** User corrections applied to a previously created ticket email. */
export interface TicketEmailCorrections {
	applicationUrl?: string
	journeyStatus?: JourneyStatus
}

/**
 * Fan-facing ticket-email RPC client. Owns the Connect client and the generated
 * request types, and returns domain `TicketEmail` entities so no consumer outside
 * this adapter touches proto types. Mirrors the transport/error structure of the
 * other clients in this directory (auth at the transport, ConnectError propagates).
 */
export class TicketEmailRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketEmailRpcClient')
	private readonly client: Client<typeof TicketEmailService>

	constructor() {
		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(TicketEmailService, transport)
	}

	/** Parse + persist a shared email body; returns one record per event id. */
	public async create(
		rawBody: string,
		emailType: TicketEmailType,
		eventIds: string[],
		signal?: AbortSignal,
	): Promise<TicketEmail[]> {
		this.logger.info('Creating ticket email', {
			emailType,
			eventCount: eventIds.length,
		})
		try {
			const response = await this.client.createTicketEmail(
				{
					rawBody,
					emailType: emailTypeTo(emailType),
					eventIds: eventIds.map((id) => ({ value: id })),
				},
				{ signal },
			)
			return response.ticketEmails.map(ticketEmailFrom)
		} catch (err) {
			this.logger.warn('CreateTicketEmail failed', { error: err })
			throw err
		}
	}

	/** Apply user corrections to a record; returns the updated domain entity. */
	public async update(
		ticketEmailId: string,
		corrections: TicketEmailCorrections,
		signal?: AbortSignal,
	): Promise<TicketEmail | undefined> {
		this.logger.info('Updating ticket email', { ticketEmailId })
		try {
			const response = await this.client.updateTicketEmail(
				{
					ticketEmailId: { value: ticketEmailId },
					applicationUrl: corrections.applicationUrl,
					journeyStatus:
						corrections.journeyStatus !== undefined
							? journeyStatusTo(corrections.journeyStatus)
							: undefined,
				},
				{ signal },
			)
			return response.ticketEmail
				? ticketEmailFrom(response.ticketEmail)
				: undefined
		} catch (err) {
			this.logger.warn('UpdateTicketEmail failed', { error: err })
			throw err
		}
	}
}
