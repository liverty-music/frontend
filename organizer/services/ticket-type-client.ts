import type { TicketType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import { TicketTypeService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_type/v1/ticket_type_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

/** The plain input of a TicketType change: the whole set is replaced. */
export interface UpdateTicketTypeInput {
	readonly ticketTypeId: string
	/** Whole-yen, tax-inclusive price per ticket. */
	readonly price: number
	readonly quantity: number
	readonly perAccountLimit: number
}

export const ITicketTypeClient = DI.createInterface<ITicketTypeClient>(
	'ITicketTypeClient',
	(x) => x.singleton(TicketTypeClient),
)

export interface ITicketTypeClient extends TicketTypeClient {}

/**
 * Organizer-local wrapper around the generated organizer `TicketTypeService`
 * client: {@link update} changes the price, quantity and per-account limit a
 * sale offers for one event. Errors propagate to callers.
 */
export class TicketTypeClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketTypeClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		TicketTypeService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/** Replaces the TicketType's price, quantity and limit and returns it. */
	public async update(
		input: UpdateTicketTypeInput,
		signal?: AbortSignal,
	): Promise<TicketType | undefined> {
		this.logger.info('Updating ticket type', {
			ticketTypeId: input.ticketTypeId,
		})
		try {
			const response = await this.client.update(
				{
					ticketTypeId: { value: input.ticketTypeId },
					// Whole yen; the wire field is int64 → bigint.
					price: { value: BigInt(input.price) },
					quantity: input.quantity,
					perAccountLimit: input.perAccountLimit,
				},
				{ signal },
			)
			return response.ticketType
		} catch (err) {
			this.logger.warn('update failed', {
				ticketTypeId: input.ticketTypeId,
				error: err,
			})
			throw err
		}
	}
}
