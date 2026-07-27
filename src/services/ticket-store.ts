import { DI, resolve } from 'aurelia'
import { ITicketRpcClient } from '../adapter/rpc/client/ticket-client'
import type { Ticket } from '../entities/ticket'
import { CachedResource } from './cache/cached-resource'

export const ITicketStore = DI.createInterface<ITicketStore>(
	'ITicketStore',
	(x) => x.singleton(TicketStore),
)

export interface ITicketStore extends TicketStore {}

/**
 * Owns the user's ticket list, cached via the shared SWR primitive with the
 * default (long) stale window — tickets are near-immutable soulbound entities.
 * The Tickets route re-entry paints instantly from cache; route entry / PWA
 * resume revalidate in the background.
 *
 * Keyed by user id so a shared-browser account switch cannot serve the previous
 * user's tickets. Minting a new ticket makes the cache stale — {@link invalidate}
 * exists for that write-side trigger; there is currently no in-app mint flow (mint
 * happens server-side), so freshness otherwise relies on the stale window + resume.
 */
export class TicketStore {
	private readonly rpcClient = resolve(ITicketRpcClient)

	private readonly tickets = new CachedResource<string, Ticket[]>(
		(userId) => userId,
		(userId, signal) => this.rpcClient.listTickets(userId, signal),
	)

	public async listTickets(
		userId: string,
		signal?: AbortSignal,
	): Promise<Ticket[]> {
		return this.tickets.read(userId, signal)
	}

	/**
	 * Force a background refresh of the user's ticket list (route entry / resume).
	 * The refresh coalesces at the primitive and is not tied to a per-caller
	 * signal, so it takes no `AbortSignal`.
	 */
	public async revalidateTickets(userId: string): Promise<Ticket[]> {
		return this.tickets.revalidate(userId)
	}

	public hasCache(userId: string): boolean {
		return this.tickets.has(userId)
	}

	/** Invalidate the cache after a new ticket becomes available (mint). */
	public invalidate(userId: string): void {
		this.tickets.invalidate(userId)
	}
}
