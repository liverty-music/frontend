import { DI, ILogger, observable, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import { loadFollows, saveFollows } from '../adapter/storage/guest-storage'
import type { Artist } from '../entities/artist'
import {
	DEFAULT_HYPE,
	type FollowedArtist,
	type Hype,
	hasFollow,
} from '../entities/follow'
import { IAuthService } from './auth-service'
import { IConcertStore } from './concert-store'

export const IFollowServiceClient = DI.createInterface<IFollowServiceClient>(
	'IFollowServiceClient',
	(x) => x.singleton(FollowServiceClient),
)

export interface IFollowServiceClient extends FollowServiceClient {}

/**
 * Owns the follow set + hype, resolving guest (localStorage) vs authenticated
 * (backend RPC) sources internally so callers never branch on auth state.
 *
 * Phase 4 of the entity-store layer: the guest follow queue + hype that used to
 * live behind `GuestService` now lives here directly, persisted through the
 * low-level `guest-storage` adapter. The guest queue is mutated in-place
 * (push/splice) for Aurelia array observation; hype is stored inline in each
 * `FollowedArtist` entry. `FollowStore` composes this client as its delegate
 * for the auth-boundary transitions (migration / sign-out clearing) and reads
 * the guest queue through the accessors exposed here.
 */
export class FollowServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('FollowService')
	private readonly authService = resolve(IAuthService)
	private readonly rpcClient = resolve(IFollowRpcClient)
	private readonly concertStore = resolve(IConcertStore)

	@observable public followedArtists: Artist[] = []

	/**
	 * Guest (unauthenticated) follow queue, hydrated from localStorage on
	 * construction. Mutated in place (push/splice) so Aurelia array observation
	 * still sees the change.
	 */
	private readonly guestFollowsState: FollowedArtist[] = loadFollows()

	public get followedIds(): ReadonlySet<string> {
		return new Set(this.followedArtists.map((a) => a.id))
	}

	public get followedCount(): number {
		return this.followedArtists.length
	}

	/**
	 * The persisted guest follow queue. Read by FollowStore's migration drain
	 * and the boot reconcile task. The array is mutated in place so this is a
	 * live reference, not a snapshot.
	 */
	public get guestFollows(): readonly FollowedArtist[] {
		return this.guestFollowsState
	}

	/**
	 * Hydrate follow state from persisted guest follows (onboarding page-load).
	 */
	public hydrate(artists: Artist[]): void {
		this.followedArtists = [...artists]
	}

	/**
	 * Evict the followed-artist projection cache. Owned by this client (the
	 * @observable field's owner) so any cache invalidation tied to the
	 * projection runs through the owner rather than an external cross-object
	 * write. Called by FollowStore on sign-out.
	 */
	public clear(): void {
		this.followedArtists = []
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
	 * localStorage write. Used by FollowStore's migration drain: persisting once
	 * per artist would be an O(n^2) byte cost (full JSON.stringify + setItem per
	 * item) on the latency-sensitive post-signup path. This drains in memory and
	 * persists once. Per-item correctness is preserved: callers pass ONLY the ids
	 * that fully migrated, so failed items remain in the queue for boot
	 * reconciliation to retry. No-op for ids absent from the queue.
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
	 * Clear the guest follow queue (in-memory + persisted). Used by FollowStore's
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
}
