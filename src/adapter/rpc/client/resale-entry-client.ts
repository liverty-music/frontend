import { ResaleEntryService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/resale_entry/v1/resale_entry_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { ResaleEntry } from '../../../entities/resale-entry'
import type { TicketStock } from '../../../entities/ticket-sale'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import {
	resaleEntriesFrom,
	resaleEntryFrom,
} from '../mapper/resale-entry-mapper'
import { ticketStockFrom } from '../mapper/ticket-sale-mapper'

export const IResaleEntryRpcClient = DI.createInterface<IResaleEntryRpcClient>(
	'IResaleEntryRpcClient',
	(x) => x.singleton(ResaleEntryRpcClient),
)

export interface IResaleEntryRpcClient extends ResaleEntryRpcClient {}

/** A card authorization AuthorizeCard opened, for Confirm to make the entry from. */
export interface ResaleCardAuthorization {
	/** The card authorization's id; Confirm names it. */
	readonly id: string
	/** The secret the browser confirms with the payment provider (3D Secure). */
	readonly secret: string
}

/** The fan's resale entries with the TicketStock each asks for. */
export interface ResaleEntries {
	readonly entries: readonly ResaleEntry[]
	/** The entries' TicketStocks by id, each with its seat type's name and price. */
	readonly stocks: ReadonlyMap<string, TicketStock>
}

/**
 * The signed-in fan's official resale entries (`ResaleEntryService`).
 * AuthorizeCard opens a card authorization for a ticket count of a sold-out
 * TicketStock, and Confirm makes the Entered entry from it once the card is
 * authenticated; no entry exists before Confirm. The fan is the caller; no
 * request names them. ConnectErrors propagate to the caller, which tells
 * the fan what happened.
 */
export class ResaleEntryRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('ResaleEntryRpcClient')
	private readonly client: Client<typeof ResaleEntryService> = createClient(
		ResaleEntryService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Saves the full name and phone number on the fan's account and opens a
	 * card authorization for `count` tickets of the TicketStock's resale.
	 * `referralCode` is the code of the referral link the fan came from, if
	 * any; it goes onto the entry Confirm makes.
	 */
	public async authorizeCard(
		ticketStockId: string,
		count: number,
		fullName: string,
		phoneNumber: string,
		referralCode?: string,
		signal?: AbortSignal,
	): Promise<ResaleCardAuthorization> {
		this.logger.info('Authorizing card for resale entry', {
			ticketStockId,
			count,
		})
		const resp = await this.client.authorizeCard(
			{
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
	): Promise<ResaleEntry> {
		this.logger.info('Confirming resale entry')
		const resp = await this.client.confirm(
			{ cardAuthorizationId: { value: cardAuthorizationId } },
			{ signal },
		)
		if (!resp.resaleEntry) throw new Error('Confirm returned no resale entry')
		return resaleEntryFrom(resp.resaleEntry, resp.order)
	}

	/** All of the fan's resale entries, newest first, with their TicketStocks. */
	public async list(signal?: AbortSignal): Promise<ResaleEntries> {
		const resp = await this.client.list({}, { signal })
		const seatTypes = new Map(
			resp.seatTypes.flatMap((t) => (t.id ? [[t.id.value, t] as const] : [])),
		)
		const stocks = new Map(
			resp.ticketStocks.map((s) => {
				const stock = ticketStockFrom(s, seatTypes)
				return [stock.id, stock] as const
			}),
		)
		const entries = resaleEntriesFrom(resp.resaleEntries, resp.orders).sort(
			(a, b) => b.createTime.getTime() - a.createTime.getTime(),
		)
		return { entries, stocks }
	}

	/** Withdraws one of the fan's entries that waits for a draw. */
	public async withdraw(
		resaleEntryId: string,
		signal?: AbortSignal,
	): Promise<ResaleEntry> {
		this.logger.info('Withdrawing a resale entry', { resaleEntryId })
		const resp = await this.client.withdraw(
			{ resaleEntryId: { value: resaleEntryId } },
			{ signal },
		)
		if (!resp.resaleEntry) throw new Error('Withdraw returned no resale entry')
		// Withdraw returns the entry alone; its stock and count do not change.
		return resaleEntryFrom(resp.resaleEntry, undefined)
	}
}
