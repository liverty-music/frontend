import { DEFAULT_STALE_TIME_MS, RevalidatingCache } from './revalidating-cache'

/**
 * A single cached read resource: binds ONE key-builder and ONE fetcher (defined
 * at construction) over a {@link RevalidatingCache}, so a store exposes
 * `read` / `revalidate` / `has` / `invalidate` for that resource without
 * repeating the key expression or the fetcher lambda across those methods.
 *
 * `I` is the per-call input (e.g. `{ country, tag, limit }` or a user id); the
 * key-builder derives the complete cache key from it. Use `void`/`undefined` for
 * a single-key resource.
 */
export class CachedResource<I, T> {
	private readonly cache: RevalidatingCache<T>

	constructor(
		private readonly keyOf: (input: I) => string,
		private readonly fetch: (input: I, signal?: AbortSignal) => Promise<T>,
		private readonly staleTime: number = DEFAULT_STALE_TIME_MS,
	) {
		this.cache = new RevalidatingCache<T>()
	}

	/** Stale-while-revalidate read for `input`. */
	public read(input: I, signal?: AbortSignal): Promise<T> {
		return this.cache.get(this.keyOf(input), (s) => this.fetch(input, s), {
			staleTime: this.staleTime,
			signal,
		})
	}

	/** Force a background refresh for `input` (route entry / PWA resume). */
	public revalidate(input: I): Promise<T> {
		return this.cache.revalidate(this.keyOf(input), (s) => this.fetch(input, s))
	}

	/** Whether a (possibly stale) value is cached for `input`. */
	public has(input: I): boolean {
		return this.cache.has(this.keyOf(input))
	}

	/** Synchronous cached read — undefined when absent. Does not trigger a fetch. */
	public peek(input: I): T | undefined {
		return this.cache.peek(this.keyOf(input))
	}

	/** Invalidate `input` so its next read refetches (mutations). */
	public invalidate(input: I): void {
		this.cache.invalidate(this.keyOf(input))
	}

	/**
	 * Invalidate every cached key at once. Use when a change invalidates the whole
	 * resource regardless of input (e.g. a follow-set change invalidates all
	 * date-window variants), where a single-key {@link invalidate} would miss
	 * sibling keys.
	 */
	public clear(): void {
		this.cache.clear()
	}
}
