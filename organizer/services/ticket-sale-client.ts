import type { TicketSale } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketSaleMethod,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import type { TicketType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import {
	type LotteryEntryStats,
	type ReferralCodeStats,
	TicketSaleService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export type { LotteryEntryStats, ReferralCodeStats, TicketSale, TicketType }
export { TicketSaleMethod, VerificationRequirement }

/**
 * The plain, transport-agnostic input of a new sale with one TicketType for
 * one event. Times are absolute instants (the editors compose them from
 * Japan-time inputs); `price` is the whole-yen, tax-inclusive price per
 * ticket. A FirstCome sale may omit `saleEndTime` (the server uses the
 * event's start time), and `perAccountLimit` may be omitted (the server's
 * default is 4).
 */
export interface CreateTicketSaleInput {
	readonly seriesId: string
	readonly name: string
	readonly method: 'lottery' | 'firstCome'
	readonly saleStartTime: Date
	readonly saleEndTime?: Date
	readonly eventId: string
	readonly price: number
	readonly quantity: number
	readonly perAccountLimit?: number
}

/**
 * An event's sales, with each lottery TicketType's entry stats and the event's
 * Paid Orders per referral code (most Orders first; the direct group, without
 * a code, among them).
 */
export interface EventTicketSales {
	readonly ticketSales: TicketSale[]
	readonly lotteryEntryStats: LotteryEntryStats[]
	readonly referralCodeStats: ReferralCodeStats[]
}

export const ITicketSaleClient = DI.createInterface<ITicketSaleClient>(
	'ITicketSaleClient',
	(x) => x.singleton(TicketSaleClient),
)

export interface ITicketSaleClient extends TicketSaleClient {}

/**
 * Organizer-local wrapper around the generated organizer `TicketSaleService`
 * client: {@link listByEvent} reads one event's sales with their TicketTypes
 * (quantity, sold and held counts) and lottery entry stats, {@link create} opens a
 * sale by lottery or first come with one TicketType for one event, and
 * {@link setWindow} moves a sale's start and end times. The caller's
 * Organizer is resolved from the token.
 *
 * Built from organizer/shared modules via {@link createOrganizerTransport}; it
 * never imports the consumer `src/` nor the sibling `admin/` bundle. Errors
 * propagate to callers (screens choose catalog copy from the `ConnectError`
 * code and log the error).
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
			resolve(IConsoleLanguage),
		),
	)

	/**
	 * The event's sales, with the entry stats of each lottery TicketType and
	 * the purchases per referral code.
	 */
	public async listByEvent(
		eventId: string,
		signal?: AbortSignal,
	): Promise<EventTicketSales> {
		this.logger.info('Listing ticket sales', { eventId })
		try {
			const response = await this.client.listByEvent(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return {
				ticketSales: response.ticketSales,
				lotteryEntryStats: response.lotteryEntryStats,
				referralCodeStats: response.referralCodeStats,
			}
		} catch (err) {
			this.logger.warn('listByEvent failed', { eventId, error: err })
			throw err
		}
	}

	/** Creates the sale with its one TicketType and returns it. */
	public async create(
		input: CreateTicketSaleInput,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Creating ticket sale', {
			eventId: input.eventId,
			method: input.method,
		})
		try {
			const response = await this.client.create(
				{
					seriesId: { value: input.seriesId },
					name: { value: input.name },
					method:
						input.method === 'lottery'
							? TicketSaleMethod.LOTTERY
							: TicketSaleMethod.FIRST_COME,
					saleStartTime: timestampFromDate(input.saleStartTime),
					...(input.saleEndTime
						? { saleEndTime: timestampFromDate(input.saleEndTime) }
						: {}),
					ticketTypes: [
						{
							eventId: { value: input.eventId },
							// Whole yen; the wire field is int64 → bigint.
							price: { value: BigInt(input.price) },
							quantity: input.quantity,
							...(input.perAccountLimit !== undefined
								? { perAccountLimit: input.perAccountLimit }
								: {}),
						},
					],
				},
				{ signal },
			)
			return response.ticketSale
		} catch (err) {
			this.logger.warn('create failed', {
				eventId: input.eventId,
				error: err,
			})
			throw err
		}
	}

	/** Replaces the sale's start and end times and returns the sale. */
	public async setWindow(
		ticketSaleId: string,
		saleStartTime: Date,
		saleEndTime: Date,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Setting ticket sale window', { ticketSaleId })
		try {
			const response = await this.client.setWindow(
				{
					ticketSaleId: { value: ticketSaleId },
					saleStartTime: timestampFromDate(saleStartTime),
					saleEndTime: timestampFromDate(saleEndTime),
				},
				{ signal },
			)
			return response.ticketSale
		} catch (err) {
			this.logger.warn('setWindow failed', { ticketSaleId, error: err })
			throw err
		}
	}

	/** Replaces the sale's verification requirement and returns the sale. */
	public async setVerificationRequirement(
		ticketSaleId: string,
		requirement: VerificationRequirement,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Setting verification requirement', { ticketSaleId })
		try {
			const response = await this.client.setVerificationRequirement(
				{
					ticketSaleId: { value: ticketSaleId },
					verificationRequirement: requirement,
				},
				{ signal },
			)
			return response.ticketSale
		} catch (err) {
			this.logger.warn('setVerificationRequirement failed', {
				ticketSaleId,
				error: err,
			})
			throw err
		}
	}
}
