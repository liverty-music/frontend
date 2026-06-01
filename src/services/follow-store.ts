import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import { loadFollows, saveFollows } from '../adapter/storage/guest-storage'
import { ILocalStorage } from '../adapter/storage/local-storage'
import {
	GUEST_MERGED_RECEIPT_PREFIX,
	guestMergedReceiptKey,
} from '../constants/storage-keys'
import type { Artist } from '../entities/artist'
import {
	DEFAULT_HYPE,
	type FollowedArtist,
	type Hype,
	hasFollow,
} from '../entities/follow'
import { IAuthService } from './auth-service'
import { IConcertStore } from './concert-store'
import { GuestMigrationRequested } from './events/guest-migration-requested'
import { SignedOut } from './events/signed-out'

export const IFollowStore = DI.createInterface<IFollowStore>(
	'IFollowStore',
	(x) => x.singleton(FollowStore),
)

export interface IFollowStore extends FollowStore {}

/**
 * Observable owner of the follow set + hype, resolving guest (localStorage) vs
 * authenticated (backend) sources INTERNALLY so callers never branch on
 * `auth.isAuthenticated`.
 *
 * Single owner of the follow slice. It owns:
 *
 *   - the optimistic follow/unfollow/setHype/listFollowed facade and its
 *     `@observable followedArtists` projection,
 *   - the guest-vs-authed branching (guest persists to localStorage via the
 *     `guest-storage` adapter with NO RPC; authed calls `IFollowRpcClient`),
 *   - the persisted guest follow queue (push/splice in place for Aurelia array
 *     observation; hype stored inline in each `FollowedArtist`),
 *   - the auth-boundary responsibilities that used to live in
 *     `GuestDataMergeService`:
 *
 *       - `GuestMigrationRequested` → migrate the guest follow queue + hype to
 *         the backend with idempotent calls, draining each artist from the guest
 *         queue once it FULLY migrates (Follow + any non-default SetHype → only
 *         not-fully-migrated items survive) in a single batched localStorage
 *         write, then write the per-account guest-merge receipt.
 *       - `SignedOut` → clear the guest follow state AND evict the
 *         followed-artist projection so a next visitor on a shared browser sees
 *         nothing.
 *
 * `migrateGuestFollows` is also reused by the boot-reconcile task to heal a
 * crash/network partial migration on the next authenticated start.
 *
 * NOTE: `ConcertStore` reads the guest follow queue directly from the
 * `guest-storage` adapter (`loadFollows`) to avoid a DI cycle with this store,
 * and must keep doing so.
 */
export class FollowStore {
	private readonly logger = resolve(ILogger).scopeTo('FollowStore')
	private readonly authService = resolve(IAuthService)
	private readonly rpcClient = resolve(IFollowRpcClient)
	private readonly concertStore = resolve(IConcertStore)
	private readonly storage = resolve(ILocalStorage)
	private readonly ea = resolve(IEventAggregator)

	@observable public followedArtists: Artist[] = []

	/**
	 * Guest (unauthenticated) follow queue, hydrated from localStorage on
	 * construction. Mutated in place (push/splice) so Aurelia array observation
	 * still sees the change.
	 */
	private readonly guestFollowsState: FollowedArtist[] = loadFollows()

	constructor() {
		// GuestMigrationRequested fires on every successful authenticated callback
		// (sign-up AND returning sign-in) after the user id exists. Migration is
		// best-effort background work: a failure must not surface to the publisher
		// (auth-callback navigation), so swallow + log here. The receipt guard +
		// empty-queue no-op inside migrateGuestFollows make a redundant fire safe.
		this.ea.subscribe(
			GuestMigrationRequested,
			(event: GuestMigrationRequested) => {
				void this.migrateGuestFollows(event.userId).catch((err) => {
					this.logger.error('Guest follow migration failed', { error: err })
				})
			},
		)

		// SignedOut fires before the OIDC sign-out redirect. Self-clear is
		// synchronous and idempotent. Also drop the guest-merge receipts so a
		// fresh post-sign-out guest session can migrate NEW follows again — the
		// receipt's lifetime is one authenticated session, not forever.
		this.ea.subscribe(SignedOut, () => {
			this.clear()
			this.clearReceipts()
		})
	}

	public get followedIds(): ReadonlySet<string> {
		return new Set(this.followedArtists.map((a) => a.id))
	}

	public get followedCount(): number {
		return this.followedArtists.length
	}

	/**
	 * The persisted guest follow queue. Read by the migration drain and the boot
	 * reconcile task. The array is mutated in place so this is a live reference,
	 * not a snapshot.
	 */
	public get guestFollows(): readonly FollowedArtist[] {
		return this.guestFollowsState
	}

	/**
	 * Hydrate the observable follow projection from persisted guest follows
	 * (onboarding page-load).
	 */
	public hydrate(artists: Artist[]): void {
		this.followedArtists = [...artists]
	}

	/**
	 * Follow an artist with optimistic UI update.
	 * Guest users persist to localStorage. Authenticated users call the backend
	 * RPC with rollback on failure.
	 */
	public async follow(artist: Artist): Promise<void> {
		if (this.followedIds.has(artist.id)) return
		this.logger.info('Following artist', { artist: artist.name })

		// Optimistic update
		const prev = this.followedArtists
		this.followedArtists = [...prev, artist]

		if (!this.authService.isAuthenticated) {
			this.followGuest(artist)
			this.logger.info('Artist followed (guest)', {
				followed: this.followedCount,
			})
			return
		}

		try {
			await this.rpcClient.follow(artist.id)
			this.concertStore.invalidateFollowerCache()
			this.logger.info('Artist followed', {
				followed: this.followedCount,
			})
		} catch (err) {
			// Rollback
			this.followedArtists = prev
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})
			throw err
		}
	}

	/**
	 * Unfollow an artist. Unauthenticated users write to guest storage.
	 * Authenticated users call the backend RPC.
	 */
	public async unfollow(artistId: string): Promise<void> {
		if (!this.authService.isAuthenticated) {
			this.unfollowGuest(artistId)
			this.followedArtists = this.followedArtists.filter(
				(a) => a.id !== artistId,
			)
			return
		}
		await this.rpcClient.unfollow(artistId)
		this.concertStore.invalidateFollowerCache()
		this.followedArtists = this.followedArtists.filter((a) => a.id !== artistId)
	}

	/**
	 * List followed artists. Unauthenticated users read from guest storage.
	 * Authenticated users call the backend ListFollowed RPC.
	 */
	public async listFollowed(signal?: AbortSignal): Promise<FollowedArtist[]> {
		let result: FollowedArtist[]
		if (!this.authService.isAuthenticated) {
			result = [...this.guestFollowsState]
		} else {
			result = await this.rpcClient.listFollowed(signal)
		}
		this.followedArtists = result.map((f) => f.artist)
		return result
	}

	/**
	 * Set the hype level for a followed artist. Unauthenticated users persist to
	 * guest storage; authenticated users call the backend RPC.
	 */
	public async setHype(artistId: string, hype: Hype): Promise<void> {
		if (!this.authService.isAuthenticated) {
			this.setHypeGuest(artistId, hype)
			return
		}
		await this.rpcClient.setHype(artistId, hype)
	}

	/**
	 * Build a lookup map of followed artists keyed by artist ID.
	 * Used by dashboard-route to enrich concert data with artist info and hype levels.
	 */
	public async getFollowedArtistMap(
		signal?: AbortSignal,
	): Promise<Map<string, { artist: Artist; hype: Hype }>> {
		const followed = await this.listFollowed(signal)
		const map = new Map<string, { artist: Artist; hype: Hype }>()
		for (const fa of followed) {
			const id = fa.artist.id
			if (id) {
				map.set(id, { artist: fa.artist, hype: fa.hype })
			}
		}
		return map
	}

	/**
	 * Migrate the guest follow queue + non-default hype to the backend with
	 * idempotent calls. An item counts as FULLY migrated — and is drained from
	 * the queue — only when BOTH its `Follow` AND (when hype != DEFAULT) its
	 * `SetHype` succeed. The leftover queue holds only items that did not fully
	 * migrate, which a later reconcile retries without re-following already-merged
	 * artists. On full success (every item fully migrated) writes the per-account
	 * guest-merge receipt.
	 *
	 * Why SetHype gates the drain: once the receipt exists no later reconcile
	 * re-issues SetHype, so draining an item whose Follow succeeded but whose
	 * SetHype threw would lose a non-default hype forever. Keeping such an item in
	 * the queue (and deferring the receipt) lets reconcile retry it; the backend
	 * Follow is idempotent, so the retried Follow is a no-op and the SetHype runs
	 * again.
	 *
	 * Best-effort: a single failed item is logged and does NOT abort the rest.
	 * The drain is applied in a SINGLE localStorage write at the end (not per
	 * item) to avoid an O(n^2) write storm on the post-signup hot path. Safe to
	 * call multiple times for the same account (backend Follow/SetHype are
	 * idempotent; the receipt makes the queue-level migration exactly-once).
	 */
	public async migrateGuestFollows(userId: string): Promise<void> {
		// Snapshot the queue up-front; the drain is applied once at the end.
		const queue = [...this.guestFollowsState]
		if (queue.length === 0) {
			// Nothing to migrate, but still record that this account has been
			// reconciled so a later residual-queue reconcile clears without
			// re-migrating.
			this.writeReceipt(userId)
			return
		}

		this.logger.info('Migrating guest follows', {
			userId,
			artistCount: queue.length,
		})

		// Ids of items that FULLY migrated (Follow + any required SetHype). Only
		// these are drained; everything else is left for reconcile to retry.
		const migratedIds: string[] = []
		let allMigrated = true
		for (const follow of queue) {
			const { id, name } = follow.artist
			try {
				await this.rpcClient.follow(id)
			} catch (err) {
				allMigrated = false
				this.logger.warn('Failed to follow artist during migration', {
					id,
					name,
					error: err,
				})
				continue
			}

			// Merge non-default hype before counting the item as migrated. A
			// SetHype failure means the item is NOT fully migrated: leave it in
			// the queue (do not drain) and defer the receipt so reconcile retries
			// it — otherwise the non-default hype would be lost forever once the
			// receipt suppresses re-migration.
			if (follow.hype !== DEFAULT_HYPE) {
				try {
					await this.rpcClient.setHype(id, follow.hype)
				} catch (err) {
					allMigrated = false
					this.logger.warn('Failed to set hype during migration', {
						artistId: id,
						hype: follow.hype,
						error: err,
					})
					continue
				}
			}

			migratedIds.push(id)
		}

		// Single batched drain: remove only the fully-migrated items, one write.
		this.removeGuestFollows(migratedIds)

		// Write the receipt only when every item fully migrated — a residual queue
		// means genuine failures remain, and the next reconcile should retry them
		// (no receipt yet) rather than clear them away.
		if (allMigrated) {
			this.writeReceipt(userId)
			this.logger.info('Guest follow migration completed', { userId })
		} else {
			this.logger.warn(
				'Guest follow migration left failed items; receipt deferred to reconcile',
				{ userId, remaining: this.guestFollowsState.length },
			)
		}
	}

	/**
	 * Clear the guest follow state AND evict the followed-artist projection.
	 * Idempotent and order-independent — safe to call on `SignedOut` regardless
	 * of other stores' clear order. Preserves the privacy guarantee of the old
	 * `GuestService.clearAll()` sign-out path: a next visitor on a shared browser
	 * sees no follows.
	 */
	public clear(): void {
		this.clearGuestFollows()
		this.followedArtists = []
		this.logger.info('Follow state cleared')
	}

	/**
	 * Reset the guest follow slice for a fresh tutorial start (welcome route).
	 * Same effect as the sign-out `clear()` — drops the guest follow queue and
	 * evicts the projection. Named separately so the welcome reset coordinator
	 * reads as a deliberate guest-state reset rather than a sign-out side effect.
	 */
	public clearGuest(): void {
		this.clear()
	}

	// --- Guest follow queue (localStorage-backed) ---

	/**
	 * Follow an artist in the guest queue. No-op if already followed.
	 */
	private followGuest(artist: Artist): void {
		if (hasFollow(this.guestFollowsState, artist.id)) return
		this.guestFollowsState.push({ artist, hype: DEFAULT_HYPE })
		this.persistGuestFollows()
		this.logger.info('Local artist followed', {
			id: artist.id,
			name: artist.name,
		})
	}

	/**
	 * Unfollow an artist from the guest queue.
	 */
	private unfollowGuest(id: string): void {
		const idx = this.guestFollowsState.findIndex((f) => f.artist.id === id)
		if (idx >= 0) {
			this.guestFollowsState.splice(idx, 1)
			this.persistGuestFollows()
			this.logger.info('Local artist unfollowed', { id })
		}
	}

	/**
	 * Set the hype level for a guest-followed artist (persisted to localStorage).
	 */
	private setHypeGuest(artistId: string, hype: Hype): void {
		const entry = this.guestFollowsState.find((f) => f.artist.id === artistId)
		if (entry) {
			entry.hype = hype
			this.persistGuestFollows()
			this.logger.info('Local hype set', { artistId, hype })
		}
	}

	/**
	 * Remove a batch of followed artists from the guest queue in a SINGLE
	 * localStorage write. Used by the migration drain: persisting once per artist
	 * would be an O(n^2) byte cost (full JSON.stringify + setItem per item) on the
	 * latency-sensitive post-signup path. This drains in memory and persists once.
	 * Per-item correctness is preserved: callers pass ONLY the ids that fully
	 * migrated, so failed items remain in the queue for boot reconciliation to
	 * retry. No-op for ids absent from the queue.
	 */
	public removeGuestFollows(ids: readonly string[]): void {
		if (ids.length === 0) return
		const remove = new Set(ids)
		const before = this.guestFollowsState.length
		// Mutate in place (filter into a fresh array, then splice-replace) so
		// Aurelia's array observation still sees the change.
		const remaining = this.guestFollowsState.filter(
			(f) => !remove.has(f.artist.id),
		)
		if (remaining.length === before) return
		this.guestFollowsState.splice(
			0,
			this.guestFollowsState.length,
			...remaining,
		)
		this.persistGuestFollows()
	}

	/**
	 * Clear the guest follow queue (in-memory + persisted). Used by the
	 * `SignedOut` self-clear and the boot reconcile task. Idempotent — a no-op on
	 * an already-empty queue.
	 */
	public clearGuestFollows(): void {
		this.guestFollowsState.splice(0)
		this.persistGuestFollows()
	}

	private persistGuestFollows(): void {
		saveFollows(this.guestFollowsState)
	}

	/** Whether the per-account guest-merge receipt exists. */
	public hasReceipt(userId: string): boolean {
		return this.storage.getItem(guestMergedReceiptKey(userId)) !== null
	}

	private writeReceipt(userId: string): void {
		this.storage.setItem(guestMergedReceiptKey(userId), '1')
	}

	/**
	 * Remove every per-account guest-merge receipt on sign-out. Cleared by prefix
	 * because the signed-out user's id is already gone from in-memory + cached
	 * state by the time `SignedOut` fires (the sign-out call sites run
	 * `userStore.clear()` first). This bounds the receipt's lifetime to a
	 * single authenticated session: the within-session no-resurrection guarantee
	 * stays intact (the receipt still blocks re-migrating reverted state WHILE
	 * signed in), but a fresh guest session after sign-out can migrate again.
	 */
	private clearReceipts(): void {
		this.storage.removeByPrefix(GUEST_MERGED_RECEIPT_PREFIX)
	}
}
