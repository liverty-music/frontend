import {
	type TicketEmail,
	TicketEmailType,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_email_pb.js'
import { EventId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketEmailService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/ticket_email/v1/ticket_email_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const ITicketEmailService = DI.createInterface<ITicketEmailService>(
	'ITicketEmailService',
	(x) => x.singleton(TicketEmailServiceClient),
)

export interface ITicketEmailService extends TicketEmailServiceClient {}

export type EmailType = 'lottery_info' | 'lottery_result'

export class TicketEmailServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketEmailService')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		TicketEmailService,
		createTransport(this.authService, resolve(ILogger).scopeTo('Transport')),
	)

	public async create(
		rawBody: string,
		emailType: EmailType,
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
					emailType: emailTypeToProto[emailType],
					eventIds: eventIds.map((id) => new EventId({ value: id })),
				},
				{ signal },
			)
			return response.ticketEmails
		} catch (err) {
			this.logger.warn('CreateTicketEmail failed', { error: err })
			throw err
		}
	}

	public async update(
		ticketEmailId: string,
		corrections: UpdateCorrections,
		signal?: AbortSignal,
	): Promise<TicketEmail | undefined> {
		this.logger.info('Updating ticket email', { ticketEmailId })
		try {
			const response = await this.client.updateTicketEmail(
				{
					ticketEmailId: { value: ticketEmailId },
					...corrections,
				},
				{ signal },
			)
			return response.ticketEmail
		} catch (err) {
			this.logger.warn('UpdateTicketEmail failed', { error: err })
			throw err
		}
	}
}

export interface UpdateCorrections {
	applicationUrl?: string
	lotteryResult?: number
	paymentStatus?: number
}

const emailTypeToProto: Record<EmailType, TicketEmailType> = {
	lottery_info: TicketEmailType.LOTTERY_INFO,
	lottery_result: TicketEmailType.LOTTERY_RESULT,
}
