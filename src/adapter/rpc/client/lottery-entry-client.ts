import { LotteryEntryService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/lottery_entry/v1/lottery_entry_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { LotteryEntry } from '../../../entities/lottery-entry'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import {
	lotteryEntriesFrom,
	lotteryEntryFrom,
} from '../mapper/lottery-entry-mapper'

export const ILotteryEntryRpcClient =
	DI.createInterface<ILotteryEntryRpcClient>('ILotteryEntryRpcClient', (x) =>
		x.singleton(LotteryEntryRpcClient),
	)

export interface ILotteryEntryRpcClient extends LotteryEntryRpcClient {}

/** A card authorization AuthorizeCard opened, for Confirm to make the entry from. */
export interface LotteryCardAuthorization {
	/** The payment provider's id of the card authorization; Confirm names it. */
	readonly id: string
	/** The secret the browser confirms with the payment provider (3D Secure). */
	readonly secret: string
}

/**
 * The signed-in fan's lottery entries (`LotteryEntryService`). AuthorizeCard
 * opens a card authorization for a ticket count of a sale's TicketStock, and Confirm
 * makes the Entered entry from it once the card is authenticated; no entry
 * exists before Confirm. The fan is the caller; no request names them.
 * ConnectErrors propagate to the caller, which tells the fan what happened.
 */
export class LotteryEntryRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('LotteryEntryRpcClient')
	private readonly client: Client<typeof LotteryEntryService> = createClient(
		LotteryEntryService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Saves the full name and phone number on the fan's account and opens a
	 * card authorization for `count` tickets of the TicketStock in the
	 * lottery sale. Authorizing again, for another count, opens a new card
	 * authorization.
	 * `referralCode` is the code of the referral link the fan came from, if
	 * any; it goes with the card authorization onto the entry Confirm makes.
	 */
	public async authorizeCard(
		ticketSaleId: string,
		ticketStockId: string,
		count: number,
		fullName: string,
		phoneNumber: string,
		referralCode?: string,
		signal?: AbortSignal,
	): Promise<LotteryCardAuthorization> {
		this.logger.info('Authorizing card for lottery entry', {
			ticketSaleId,
			ticketStockId,
			count,
		})
		const resp = await this.client.authorizeCard(
			{
				ticketSaleId: { value: ticketSaleId },
				ticketStockId: { value: ticketStockId },
				ticketCount: count,
				fullName: { value: fullName },
				phoneNumber: { value: phoneNumber },
				referralCode: referralCode ? { value: referralCode } : undefined,
			},
			{ signal },
		)
		const id = resp.cardAuthorizationId?.value
		const secret = resp.cardAuthorizationSecret?.value
		if (!id || !secret) {
			throw new Error('AuthorizeCard returned no card authorization')
		}
		return { id, secret }
	}

	/**
	 * Makes the Entered entry from the card authorization once the card is
	 * authenticated. Confirming it again returns the same entry.
	 */
	public async confirm(
		cardAuthorizationId: string,
		signal?: AbortSignal,
	): Promise<LotteryEntry> {
		this.logger.info('Confirming lottery entry')
		const resp = await this.client.confirm(
			{ cardAuthorizationId: { value: cardAuthorizationId } },
			{ signal },
		)
		if (!resp.lotteryEntry) throw new Error('Confirm returned no lottery entry')
		return lotteryEntryFrom(resp.lotteryEntry, resp.order)
	}

	/**
	 * The fan's entries in the lottery sale, each with its TicketStock and
	 * count: at most one per event the sale names.
	 */
	public async listBySale(
		ticketSaleId: string,
		signal?: AbortSignal,
	): Promise<LotteryEntry[]> {
		const resp = await this.client.listByTicketType(
			{ ticketSaleId: { value: ticketSaleId } },
			{ signal },
		)
		return lotteryEntriesFrom(resp.lotteryEntries, resp.orders)
	}
}
