import { LotteryEntryService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/lottery_entry/v1/lottery_entry_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { LotteryEntry } from '../../../entities/lottery-entry'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { lotteryEntryFrom } from '../mapper/lottery-entry-mapper'

export const ILotteryEntryRpcClient =
	DI.createInterface<ILotteryEntryRpcClient>('ILotteryEntryRpcClient', (x) =>
		x.singleton(LotteryEntryRpcClient),
	)

export interface ILotteryEntryRpcClient extends LotteryEntryRpcClient {}

/**
 * The signed-in fan's lottery entries (`LotteryEntryService`). An entry is
 * started as a Draft, its card is authorized with AuthorizeCard, and Confirm
 * enters it into the draw. The fan is the caller; no request names them.
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
	 * Starts a Draft entry for `count` tickets of the TicketType, or returns the
	 * fan's Draft when the count is the same. A Draft with another count is
	 * changed to the new count and loses its card authorization.
	 * `referralCode` is the code of the referral link the fan came from, if
	 * any; the server records it while the entry is a Draft.
	 */
	public async start(
		ticketTypeId: string,
		count: number,
		referralCode?: string,
		signal?: AbortSignal,
	): Promise<LotteryEntry> {
		this.logger.info('Starting lottery entry', { ticketTypeId, count })
		const resp = await this.client.start(
			{
				ticketTypeId: { value: ticketTypeId },
				ticketCount: count,
				referralCode: referralCode ? { value: referralCode } : undefined,
			},
			{ signal },
		)
		if (!resp.lotteryEntry) throw new Error('Start returned no lottery entry')
		return lotteryEntryFrom(resp.lotteryEntry)
	}

	/**
	 * Saves the full name and phone number on the fan's account and opens the
	 * Draft's card authorization, returning the card authorization secret the
	 * browser confirms with the payment provider.
	 */
	public async authorizeCard(
		lotteryEntryId: string,
		fullName: string,
		phoneNumber: string,
		signal?: AbortSignal,
	): Promise<string> {
		this.logger.info('Authorizing card for lottery entry', { lotteryEntryId })
		const resp = await this.client.authorizeCard(
			{
				lotteryEntryId: { value: lotteryEntryId },
				fullName: { value: fullName },
				phoneNumber: { value: phoneNumber },
			},
			{ signal },
		)
		const secret = resp.cardAuthorizationSecret?.value
		if (!secret) {
			throw new Error('AuthorizeCard returned no card authorization secret')
		}
		return secret
	}

	/** Enters the Draft into the draw once its card authorization is confirmed. */
	public async confirm(
		lotteryEntryId: string,
		signal?: AbortSignal,
	): Promise<LotteryEntry> {
		this.logger.info('Confirming lottery entry', { lotteryEntryId })
		const resp = await this.client.confirm(
			{ lotteryEntryId: { value: lotteryEntryId } },
			{ signal },
		)
		if (!resp.lotteryEntry) throw new Error('Confirm returned no lottery entry')
		return lotteryEntryFrom(resp.lotteryEntry)
	}

	/** The fan's entries for the TicketType, newest first. */
	public async listByTicketType(
		ticketTypeId: string,
		signal?: AbortSignal,
	): Promise<LotteryEntry[]> {
		const resp = await this.client.listByTicketType(
			{ ticketTypeId: { value: ticketTypeId } },
			{ signal },
		)
		return resp.lotteryEntries.map(lotteryEntryFrom)
	}
}
