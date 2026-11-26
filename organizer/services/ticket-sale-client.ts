import type { TicketSale } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketSaleMethod,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	type LotteryEntryStats,
	type ReferralCodeStats,
	TicketSaleService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { dateTimeInit } from '../../shared/lib/zoned-time/proto'
import type { WallClock } from '../../shared/lib/zoned-time/zoned-time'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export type { LotteryEntryStats, ReferralCodeStats, TicketSale }
export { TicketSaleMethod, VerificationRequirement }

/**
 * A sale's window: civil date-times in the sale's IANA time zone, as the
 * member entered them. The server stores them as wall-clock times with the
 * zone.
 */
export interface SaleWindowInput {
	readonly saleStart: WallClock
	readonly saleEnd: WallClock
	readonly timeZone: string
}

/**
 * The plain, transport-agnostic input of a new sale of one event. Its window
 * is a {@link SaleWindowInput}. The
 * sale sells every TicketStock of its events; prices are on the seat types,
 * quantities on the stocks and the per-account limit on the event.
 */
export interface CreateTicketSaleInput extends SaleWindowInput {
	readonly seriesId: string
	readonly name: string
	readonly method: 'lottery' | 'firstCome'
	readonly eventIds: readonly string[]
}

/**
 * An event's sales, with each lottery sale's entry stats per TicketStock and the event's
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
 * client: {@link listByEvent} reads one event's sales with the lottery entry
 * stats of each TicketStock, {@link create} opens a sale by lottery or first
 * come naming its events, and
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
	 * The event's sales, with the entry stats of each lottery sale per
	 * TicketStock and the purchases per referral code.
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

	/** Creates the sale naming its events and returns it. */
	public async create(
		input: CreateTicketSaleInput,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Creating ticket sale', {
			eventIds: input.eventIds,
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
					saleStartTime: dateTimeInit(input.saleStart, input.timeZone),
					saleEndTime: dateTimeInit(input.saleEnd, input.timeZone),
					eventIds: input.eventIds.map((id) => ({ value: id })),
				},
				{ signal },
			)
			return response.ticketSale
		} catch (err) {
			this.logger.warn('create failed', {
				eventIds: input.eventIds,
				error: err,
			})
			throw err
		}
	}

	/** Replaces the sale's start and end times (in its zone) and returns the sale. */
	public async setWindow(
		ticketSaleId: string,
		window: SaleWindowInput,
		signal?: AbortSignal,
	): Promise<TicketSale | undefined> {
		this.logger.info('Setting ticket sale window', { ticketSaleId })
		try {
			const response = await this.client.setWindow(
				{
					ticketSaleId: { value: ticketSaleId },
					saleStartTime: dateTimeInit(window.saleStart, window.timeZone),
					saleEndTime: dateTimeInit(window.saleEnd, window.timeZone),
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
