import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { ITicketJourneyRpcClient } from '../adapter/rpc/client/ticket-journey-client'
import type { JourneyStatus } from '../entities/concert'
import { IAuthService } from './auth-service'
import { SignedOut } from './events/signed-out'

export const ITicketJourneyStore = DI.createInterface<ITicketJourneyStore>(
	'ITicketJourneyStore',
	(x) => x.singleton(TicketJourneyStore),
)

export interface ITicketJourneyStore extends TicketJourneyStore {}

/**
 * Single observable owner of ticket-journey status (event id → status).
 *
 * The Dashboard and the event detail sheet both read from this store, so a
 * status change from either surface reflects everywhere without a re-fetch or a
 * route re-entry — fixing the previous bug where each held a separate copy and
 * diverged until the dashboard route was re-entered.
 *
 * Reads (`load` → `listByUser`) are network-first (no stale window). Writes
 * (`setStatus`, `delete`) are write-through: the RPC runs first, and the
 * observable map is updated only after it succeeds, so a failed write never
 * desyncs the store. The map reference is replaced on every mutation so Aurelia
 * observation fires. Cleared on sign-out so a next visitor on a shared browser
 * never reads the previous user's journey.
 */
export class TicketJourneyStore {
	private readonly logger = resolve(ILogger).scopeTo('TicketJourneyStore')
	private readonly rpcClient = resolve(ITicketJourneyRpcClient)
	private readonly authService = resolve(IAuthService)
	private readonly ea = resolve(IEventAggregator)

	@observable public journeyMap: Map<string, JourneyStatus> = new Map()

	// Bumped on every write-through / clear. A load() captures it at issue and
	// skips its assignment if a write landed while the RPC was in flight, so a
	// stale server snapshot can never clobber a newer optimistic write.
	private writeGeneration = 0

	constructor() {
		// Self-clear on sign-out (idempotent, order-independent), matching the
		// per-store sign-out clear contract of the other entity stores.
		this.ea.subscribe(SignedOut, () => this.clear())
	}

	/** Read a single event's journey status from the observable map. */
	public statusFor(eventId: string | undefined): JourneyStatus | undefined {
		return eventId ? this.journeyMap.get(eventId) : undefined
	}

	/**
	 * Populate the store from the backend (network-first, always fresh). Guests
	 * have no server journeys — return an empty map without an RPC. The returned
	 * map is also surfaced via the observable so consumers can read either way.
	 */
	public async load(signal?: AbortSignal): Promise<Map<string, JourneyStatus>> {
		if (!this.authService.isAuthenticated) {
			this.journeyMap = new Map()
			return this.journeyMap
		}
		const generationAtIssue = this.writeGeneration
		const map = await this.rpcClient.listByUser(signal)
		// Skip the assignment if a write-through (or clear) landed while this RPC
		// was in flight — its result is newer than this server snapshot. Return the
		// authoritative current map either way.
		if (this.writeGeneration === generationAtIssue) {
			this.journeyMap = map
		}
		return this.journeyMap
	}

	/**
	 * Write-through status change: issue the RPC, then update the observable map
	 * only on success. On failure the map is left unchanged (no optimistic write).
	 */
	public async setStatus(
		eventId: string,
		status: JourneyStatus,
		signal?: AbortSignal,
	): Promise<void> {
		await this.rpcClient.setStatus(eventId, status, signal)
		const next = new Map(this.journeyMap)
		next.set(eventId, status)
		this.journeyMap = next
		this.writeGeneration++
	}

	/** Write-through delete: issue the RPC, then drop the entry on success. */
	public async delete(eventId: string, signal?: AbortSignal): Promise<void> {
		await this.rpcClient.delete(eventId, signal)
		const next = new Map(this.journeyMap)
		next.delete(eventId)
		this.journeyMap = next
		this.writeGeneration++
	}

	/** Clear all journey state (sign-out). */
	public clear(): void {
		this.writeGeneration++
		this.journeyMap = new Map()
		this.logger.info('Journey state cleared')
	}
}
