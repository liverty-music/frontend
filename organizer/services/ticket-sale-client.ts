import type { TicketSale } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { TicketSaleService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export type { TicketSale }

/**
 * The plain, transport-agnostic configuration of an event's first-come sale.
 * Times are absolute instants (the editor composes them from Japan-time
 * inputs); `price` is the whole-yen, tax-inclusive price per ticket. Omitting
 * `saleEndTime` lets the server use the event's start time, and omitting
 * `perAccountLimit` its default of 4.
 */
export interface ConfigureTicketSaleInput {
	readonly eventId: string
	readonly saleStartTime: Date
	readonly saleEndTime?: Date
	readonly price: number
	readonly quantity: number
	readonly perAccountLimit?: number
}

export const ITicketSaleClient = DI.createInterface<ITicketSaleClient>(
	'ITicketSaleClient',
	(x) => x.singleton(TicketSaleClient),
)

export interface ITicketSaleClient extends TicketSaleClient {}

/**
 * Organizer-local wrapper around the generated organizer `TicketSaleService`
 * client: {@link get} reads the first-come sale of one of the caller's events
 * with its quantity, sold count and held count, and {@link configure} creates
 * or changes it. The caller's Organizer is resolved from the token.
 *
 * Built from organizer/shared modules via {@link createOrganizerTransport}; it
 * never imports the consumer `src/` nor the sibling `admin/` bundle. Errors
 * other than Get's NotFound propagate to callers (screens translate
 * `ConnectError` codes via {@link ./connect-error-copy}).
 */
export class TicketSaleClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketSaleClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		TicketSaleService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Returns the event's sale, or `undefined` when the event has none yet (the
	 * server's NotFound).
	 */
	public async get(
		eventId: string,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Getting ticket sale', { eventId })
		try {
			const response = await this.client.get(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return response.ticketSale
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.NotFound) {
				return undefined
			}
			this.logger.warn('get failed', { eventId, error: err })
			throw err
		}
	}

	/** Creates or changes the event's sale and returns it. */
	public async configure(
		input: ConfigureTicketSaleInput,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Configuring ticket sale', { eventId: input.eventId })
		try {
			const response = await this.client.configure(
				{
					eventId: { value: input.eventId },
					saleStartTime: timestampFromDate(input.saleStartTime),
					...(input.saleEndTime
						? { saleEndTime: timestampFromDate(input.saleEndTime) }
						: {}),
					// Whole yen; the wire field is int64 → bigint.
					price: BigInt(input.price),
					quantity: input.quantity,
					...(input.perAccountLimit !== undefined
						? { perAccountLimit: input.perAccountLimit }
						: {}),
				},
				{ signal },
			)
			return response.ticketSale
		} catch (err) {
			this.logger.warn('configure failed', {
				eventId: input.eventId,
				error: err,
			})
			throw err
		}
	}
}
