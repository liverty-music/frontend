/**
 * A shared stale-while-revalidate (SWR) cache primitive that Aurelia singleton
 * stores compose internally to cache read-only RPC resources.
 *
 * It is a store collaborator, NOT a second state layer: the store's observable
 * remains the single public read surface, and no component reads this cache
 * directly. The primitive only owns the bookkeeping — one cached copy per key,
 * per-key `staleTime`, in-flight coalescing, generation-fenced invalidation, and
 * forced background revalidation — so the 4-5 stores that need SWR do not each
 * hand-roll (and diverge on) TTL/dedup/invalidation.
 *
 * Semantics per key:
 *  - `get`  → SWR read: fresh hit returns the cached value with no fetch; a stale
 *             hit returns the cached value immediately AND revalidates in the
 *             background; a miss fetches, stores, and returns.
 *  - `revalidate` → force a background refetch regardless of staleness (used by
 *             route-entry and PWA-resume triggers), update the cache, return fresh.
 *  - `invalidate` → drop the entry and fence any in-flight fetch so the next read
 *             refetches (used by mutations).
 *
 * In-flight coalescing mirrors the previous bespoke concert-store cache exactly:
 * signal-less callers share one in-flight promise per key; a caller that passes an
 * `AbortSignal` gets its own fetch (a shared promise could only honour the first
 * caller's signal, so per-caller cancellation must not be coalesced away).
 */
/**
 * Default stale window shared by every cached read resource (24h). Long is safe
 * precisely because route entry and PWA resume force a background revalidation;
 * kept in one place so the freshness policy is tuned once, not per store.
 */
export const DEFAULT_STALE_TIME_MS = 24 * 60 * 60 * 1000

export interface GetOptions {
	/** Maximum age, in ms, before a cached value is considered stale. */
	staleTime: number
	/** Per-caller abort signal; when present the fetch is NOT coalesced. */
	signal?: AbortSignal
}

interface Entry<T> {
	value: T
	timestamp: number
}

export class RevalidatingCache<T> {
	private readonly store = new Map<string, Entry<T>>()
	// One shared in-flight promise per key, for signal-less coalescing.
	private readonly inFlight = new Map<string, Promise<T>>()
	// Bumped by invalidate(key); a fetch's .then() checks it to fence a superseded
	// cache write (an RPC that settles after its key was invalidated).
	private readonly generation = new Map<string, number>()

	private readonly now: () => number

	/**
	 * @param now Injectable clock (defaults to `Date.now`) so tests can drive
	 * staleness deterministically without patching globals.
	 */
	constructor(now: () => number = () => Date.now()) {
		this.now = now
	}

	/**
	 * SWR read. Returns the cached value immediately when present (revalidating in
	 * the background if it is older than `staleTime`); otherwise fetches, stores,
	 * and returns.
	 */
	public async get(
		key: string,
		fetcher: (signal?: AbortSignal) => Promise<T>,
		opts: GetOptions,
	): Promise<T> {
		const entry = this.store.get(key)
		if (entry !== undefined) {
			const isStale = this.now() - entry.timestamp >= opts.staleTime
			if (isStale) {
				// Serve stale immediately; warm the cache in the background so the
				// next read is fresh. Callers that need the fresh value swapped into
				// their observable on entry/resume use revalidate() instead.
				void this.fetchAndStore(key, fetcher).catch(() => {
					// Background revalidation failure keeps the stale value; the next
					// read/resume retries. Swallow so it never rejects.
				})
			}
			return entry.value
		}
		// Miss: block on the fetch (respecting per-caller signal + coalescing).
		return this.fetchAndStore(key, fetcher, opts.signal)
	}

	/**
	 * Force a background refetch for `key` regardless of staleness, update the
	 * cache, and return the fresh value. Used by route-entry and PWA-resume
	 * revalidation: the store paints the cached value first, then calls this to
	 * refresh in place. Coalesced (signal-less) so a route-entry + resume in the
	 * same tick share one RPC.
	 */
	public async revalidate(
		key: string,
		fetcher: (signal?: AbortSignal) => Promise<T>,
	): Promise<T> {
		return this.fetchAndStore(key, fetcher)
	}

	/**
	 * Drop the cached entry and fence any in-flight fetch so the next read
	 * refetches. Called by mutations that make a cached resource stale.
	 */
	public invalidate(key: string): void {
		this.store.delete(key)
		this.generation.set(key, (this.generation.get(key) ?? 0) + 1)
		// Post-invalidate callers must issue a fresh RPC, not join the now-stale
		// in-flight fetch.
		this.inFlight.delete(key)
	}

	/** Synchronous cached read (no fetch). Undefined when absent. */
	public peek(key: string): T | undefined {
		return this.store.get(key)?.value
	}

	/** Whether a (possibly stale) value is cached for `key`. */
	public has(key: string): boolean {
		return this.store.has(key)
	}

	private fetchAndStore(
		key: string,
		fetcher: (signal?: AbortSignal) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		// Signal-less callers coalesce onto one in-flight promise; signal-bearing
		// ones can't (a shared promise honours only the first caller's signal).
		if (signal === undefined) {
			const existing = this.inFlight.get(key)
			if (existing !== undefined) return existing
		}

		const generationAtIssue = this.generation.get(key) ?? 0
		const promise: Promise<T> = fetcher(signal)
			.then((value) => {
				// Skip the cache write if the key was invalidated since the RPC
				// issued — otherwise a follow-action's intentional invalidation
				// would be silently undone by a stale settle.
				if ((this.generation.get(key) ?? 0) === generationAtIssue) {
					this.store.set(key, { value, timestamp: this.now() })
				}
				return value
			})
			.finally(() => {
				// Own-promise identity check: only clear the slot if it still points
				// at THIS promise, so a stale finally cannot clobber a newer
				// post-invalidate in-flight that legitimately occupies the slot.
				if (this.inFlight.get(key) === promise) {
					this.inFlight.delete(key)
				}
			})

		if (signal === undefined) {
			this.inFlight.set(key, promise)
		}
		return promise
	}
}
