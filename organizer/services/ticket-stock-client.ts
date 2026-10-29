import type { SeatType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import {
	type TicketStock,
	TicketStockState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import { TicketStockService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_stock/v1/ticket_stock_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export type { TicketStock }
export { TicketStockState }

/** The plain input of a new stock: a seat type of the event's Series and its quantity. */
export interface CreateTicketStockInput {
	readonly eventId: string
	readonly seatTypeId: string
	readonly quantity: number
}

/** An event's stocks with their counts now, and the seat types they are of. */
export interface EventTicketStocks {
	readonly ticketStocks: TicketStock[]
	readonly seatTypes: SeatType[]
}

export const ITicketStockClient = DI.createInterface<ITicketStockClient>(
	'ITicketStockClient',
	(x) => x.singleton(TicketStockClient),
)

export interface ITicketStockClient extends TicketStockClient {}

/**
 * Organizer-local wrapper around the generated organizer `TicketStockService`
 * client: the tickets of each seat type an event sells (席種と枚数), with
 * their sold and held counts. A stock's quantity never changes; a mistake is
 * deleted and made again. Errors propagate to callers.
 */
export class TicketStockClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketStockClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		TicketStockService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	/** The event's stocks with their counts now, and their seat types. */
	public async listByEvent(
		eventId: string,
		signal?: AbortSignal,
	): Promise<EventTicketStocks> {
		this.logger.info('Listing ticket stocks', { eventId })
		try {
			const response = await this.client.listByEvent(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return {
				ticketStocks: response.ticketStocks,
				seatTypes: response.seatTypes,
			}
		} catch (err) {
			this.logger.warn('listByEvent failed', { eventId, error: err })
			throw err
		}
	}

	/** Stocks the event with tickets of a seat type and returns the stock. */
	public async create(
		input: CreateTicketStockInput,
		signal?: AbortSignal,
	): Promise<TicketStock | undefined> {
		this.logger.info('Creating ticket stock', {
			eventId: input.eventId,
			seatTypeId: input.seatTypeId,
		})
		try {
			const response = await this.client.create(
				{
					eventId: { value: input.eventId },
					seatTypeId: { value: input.seatTypeId },
					quantity: input.quantity,
				},
				{ signal },
			)
			return response.ticketStock
		} catch (err) {
			this.logger.warn('create failed', { eventId: input.eventId, error: err })
			throw err
		}
	}

	/** Deletes a stock that no Order other than a Void one names. */
	public async delete(
		ticketStockId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Deleting ticket stock', { ticketStockId })
		try {
			await this.client.delete(
				{ ticketStockId: { value: ticketStockId } },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('delete failed', { ticketStockId, error: err })
			throw err
		}
	}
}
