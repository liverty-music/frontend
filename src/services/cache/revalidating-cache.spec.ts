import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RevalidatingCache } from './revalidating-cache'

const STALE_TIME = 1000

describe('RevalidatingCache', () => {
	let clock: number
	let cache: RevalidatingCache<number[]>

	beforeEach(() => {
		clock = 0
		cache = new RevalidatingCache<number[]>(() => clock)
	})

	describe('get — SWR read', () => {
		it('returns the cached value on a fresh hit without issuing the fetcher', async () => {
			const fetcher = vi.fn(async () => [1])

			await cache.get('k', fetcher, { staleTime: STALE_TIME })
			clock = 500 // still within staleTime
			const result = await cache.get('k', fetcher, { staleTime: STALE_TIME })

			expect(fetcher).toHaveBeenCalledTimes(1)
			expect(result).toEqual([1])
		})

		it('issues the fetcher and stores the result on a miss', async () => {
			const fetcher = vi.fn(async () => [2])

			const result = await cache.get('k', fetcher, { staleTime: STALE_TIME })

			expect(fetcher).toHaveBeenCalledTimes(1)
			expect(result).toEqual([2])
			expect(cache.peek('k')).toEqual([2])
		})

		it('serves the stale value immediately then revalidates in the background', async () => {
			const fetcher = vi
				.fn<() => Promise<number[]>>()
				.mockResolvedValueOnce([1])
				.mockResolvedValueOnce([2])

			await cache.get('k', fetcher, { staleTime: STALE_TIME })
			clock = STALE_TIME + 1 // now stale

			// Returns the STALE value immediately (not the fresh one).
			const served = await cache.get('k', fetcher, { staleTime: STALE_TIME })
			expect(served).toEqual([1])

			// Background revalidation warms the cache with the fresh value.
			await vi.waitFor(() => expect(cache.peek('k')).toEqual([2]))
			expect(fetcher).toHaveBeenCalledTimes(2)
		})
	})

	describe('get — in-flight coalescing', () => {
		it('coalesces concurrent signal-less callers onto one fetch', async () => {
			const fetcher = vi.fn(async () => [1])

			const [a, b] = await Promise.all([
				cache.get('k', fetcher, { staleTime: STALE_TIME }),
				cache.get('k', fetcher, { staleTime: STALE_TIME }),
			])

			expect(fetcher).toHaveBeenCalledTimes(1)
			expect(a).toEqual([1])
			expect(b).toEqual([1])
		})

		it('does NOT coalesce callers that pass an AbortSignal', async () => {
			const fetcher = vi.fn(async () => [1])
			const a = new AbortController()
			const b = new AbortController()

			await Promise.all([
				cache.get('k', fetcher, { staleTime: STALE_TIME, signal: a.signal }),
				cache.get('k', fetcher, { staleTime: STALE_TIME, signal: b.signal }),
			])

			expect(fetcher).toHaveBeenCalledTimes(2)
		})
	})

	describe('invalidate', () => {
		it('forces the next read to refetch', async () => {
			const fetcher = vi.fn(async () => [1])

			await cache.get('k', fetcher, { staleTime: STALE_TIME })
			cache.invalidate('k')
			await cache.get('k', fetcher, { staleTime: STALE_TIME })

			expect(fetcher).toHaveBeenCalledTimes(2)
		})

		it('fences an in-flight fetch invalidated before it settles', async () => {
			let release: (v: number[]) => void = () => {}
			const firstRpc = new Promise<number[]>((r) => {
				release = r
			})
			const fetcher = vi
				.fn<(s?: AbortSignal) => Promise<number[]>>()
				.mockReturnValueOnce(firstRpc)
				.mockResolvedValueOnce([2])

			const firstCall = cache.get('k', fetcher, { staleTime: STALE_TIME })
			cache.invalidate('k')
			release([1])
			await firstCall

			// The fenced settle must NOT have repopulated the cache.
			const result = await cache.get('k', fetcher, { staleTime: STALE_TIME })
			expect(result).toEqual([2])
			expect(fetcher).toHaveBeenCalledTimes(2)
		})

		it('does not coalesce a post-invalidation caller onto the pre-invalidation in-flight', async () => {
			let release: (v: number[]) => void = () => {}
			const firstRpc = new Promise<number[]>((r) => {
				release = r
			})
			const fresh = [2]
			const fetcher = vi
				.fn<(s?: AbortSignal) => Promise<number[]>>()
				.mockReturnValueOnce(firstRpc)
				.mockResolvedValueOnce(fresh)

			const firstCall = cache.get('k', fetcher, { staleTime: STALE_TIME })
			cache.invalidate('k')
			const secondCall = cache.get('k', fetcher, { staleTime: STALE_TIME })
			release([1])

			await firstCall
			expect(await secondCall).toEqual(fresh)
			expect(fetcher).toHaveBeenCalledTimes(2)
		})
	})

	describe('revalidate — forced background refresh', () => {
		it('refetches even when the cached value is still fresh, and updates the cache', async () => {
			const fetcher = vi
				.fn<() => Promise<number[]>>()
				.mockResolvedValueOnce([1])
				.mockResolvedValueOnce([2])

			await cache.get('k', fetcher, { staleTime: STALE_TIME })
			// Still fresh (clock unchanged), but revalidate forces a refetch.
			const fresh = await cache.revalidate('k', fetcher)

			expect(fetcher).toHaveBeenCalledTimes(2)
			expect(fresh).toEqual([2])
			expect(cache.peek('k')).toEqual([2])
		})
	})

	describe('complete-key behaviour', () => {
		it('treats distinct keys as independent entries', async () => {
			const fetcher = vi
				.fn<(s?: AbortSignal) => Promise<number[]>>()
				.mockResolvedValueOnce([10])
				.mockResolvedValueOnce([20])

			const a = await cache.get('JP|rock|30', fetcher, {
				staleTime: STALE_TIME,
			})
			const b = await cache.get('JP|rock|50', fetcher, {
				staleTime: STALE_TIME,
			})

			expect(a).toEqual([10])
			expect(b).toEqual([20])
			expect(fetcher).toHaveBeenCalledTimes(2)
		})

		it('does not return a value cached under a different key', async () => {
			const fetcher = vi.fn(async () => [10])

			await cache.get('JP|rock|30', fetcher, { staleTime: STALE_TIME })
			// A different limit → different key → must miss (fetch again).
			await cache.get('JP|rock|50', fetcher, { staleTime: STALE_TIME })

			expect(fetcher).toHaveBeenCalledTimes(2)
		})
	})
})
