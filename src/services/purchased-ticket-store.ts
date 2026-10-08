import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { ITicketRpcClient } from '../adapter/rpc/client/ticket-client'
import { IAuthService } from './auth-service'
import { SignedOut } from './events/signed-out'

export const IPurchasedTicketStore = DI.createInterface<IPurchasedTicketStore>(
	'IPurchasedTicketStore',
	(x) => x.singleton(PurchasedTicketStore),
)

export interface IPurchasedTicketStore extends PurchasedTicketStore {}

/**
 * Count Issued tickets per event id. Voided (and any other non-Issued) tickets
 * are not counted, so a refunded purchase never shows as purchased.
 */
export function countIssuedByEvent(
	tickets: readonly Ticket[],
): Map<string, number> {
	const counts = new Map<string, number>()
	for (const t of tickets) {
		const eventId = t.eventId?.value
		if (!eventId || t.status !== TicketStatus.ISSUED) continue
		counts.set(eventId, (counts.get(eventId) ?? 0) + 1)
	}
	return counts
}

/**
 * Single observable owner of the signed-in fan's purchased (Issued) ticket
 * counts per event id. The Dashboard's first-party cards and the Event page's
 * ticket section both read it, from one `TicketService.List` call per load.
 *
 * Reads are network-first. Guests have no tickets: an empty map, no RPC.
 * Cleared on sign-out so a next visitor on a shared browser never sees the
 * previous user's purchases.
 */
export class PurchasedTicketStore {
	private readonly logger = resolve(ILogger).scopeTo('PurchasedTicketStore')
	private readonly rpcClient = resolve(ITicketRpcClient)
	private readonly authService = resolve(IAuthService)
	private readonly ea = resolve(IEventAggregator)

	@observable public countByEvent: Map<string, number> = new Map()

	constructor() {
		this.ea.subscribe(SignedOut, () => this.clear())
	}

	/** Issued tickets the fan holds for one event (0 when none). */
	public countFor(eventId: string | undefined): number {
		return eventId ? (this.countByEvent.get(eventId) ?? 0) : 0
	}

	/**
	 * Populate the store from the backend. Rejects when the RPC fails; callers
	 * that must not fail on it (the Dashboard) fall back to an empty map.
	 */
	public async load(signal?: AbortSignal): Promise<Map<string, number>> {
		if (!this.authService.isAuthenticated) {
			this.countByEvent = new Map()
			return this.countByEvent
		}
		const tickets = await this.rpcClient.getMyTickets(signal)
		this.countByEvent = countIssuedByEvent(tickets)
		return this.countByEvent
	}

	/** Clear all purchased-ticket state (sign-out). */
	public clear(): void {
		this.countByEvent = new Map()
		this.logger.info('Purchased ticket state cleared')
	}
}
