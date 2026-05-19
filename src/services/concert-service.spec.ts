import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProximityGroup } from '../adapter/rpc/client/concert-client'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockGuest = { follows: [], home: null }
const mockRpcClient = {
	listByFollower: vi.fn(async (): Promise<ProximityGroup[]> => []),
	listConcerts: vi.fn(),
	listWithProximity: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: mockAuth,
				IGuestService: mockGuest,
				IConcertRpcClient: mockRpcClient,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

import { ConcertServiceClient } from './concert-service'

function makeGroups(count: number): ProximityGroup[] {
	return Array.from({ length: count }, (_, _i) => ({
		date: undefined,
		home: [],
		nearby: [],
		away: [],
	})) as unknown as ProximityGroup[]
}

describe('ConcertServiceClient', () => {
	let sut: ConcertServiceClient

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		sut = new ConcertServiceClient()
	})

	// Restore spies (including the Date.now spy used by the TTL-expiry
	// test) in afterEach so an assertion failure in a test body cannot
	// leak the spy onto subsequent tests. A failed expect() inside the
	// body would otherwise leave Date.now permanently frozen at the
	// spied future timestamp.
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('listByFollower — caching', () => {
		it('returns cached result on second call without issuing RPC', async () => {
			const groups = makeGroups(2)
			mockRpcClient.listByFollower.mockResolvedValueOnce(groups)

			await sut.listByFollower()
			const result = await sut.listByFollower()

			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(1)
			expect(result).toBe(groups)
		})

		it('issues RPC on first call (cache miss) and stores result', async () => {
			const groups = makeGroups(3)
			mockRpcClient.listByFollower.mockResolvedValueOnce(groups)

			const result = await sut.listByFollower()

			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(1)
			expect(result).toEqual(groups)
		})

		it('re-fetches after cache TTL has expired', async () => {
			const first = makeGroups(1)
			const second = makeGroups(2)
			mockRpcClient.listByFollower
				.mockResolvedValueOnce(first)
				.mockResolvedValueOnce(second)

			await sut.listByFollower()

			// Advance time past 24h TTL
			vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000)

			const result = await sut.listByFollower()

			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(2)
			expect(result).toEqual(second)
		})
	})

	describe('invalidateFollowerCache', () => {
		it('causes next listByFollower() call to issue RPC', async () => {
			mockRpcClient.listByFollower.mockResolvedValue(makeGroups(1))

			await sut.listByFollower()
			sut.invalidateFollowerCache()
			await sut.listByFollower()

			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(2)
		})

		it('discards in-flight RPC result if invalidated before it resolves', async () => {
			// Reproduce the in-flight repopulation race: an RPC is fired,
			// invalidateFollowerCache() runs while it's in flight, then the
			// RPC settles. The settled result MUST NOT silently repopulate
			// the cache, otherwise a follow-action's intentional invalidation
			// would be undone for up to 24h.
			let releaseFirst: (groups: ProximityGroup[]) => void = () => {}
			const firstRpc = new Promise<ProximityGroup[]>((resolve) => {
				releaseFirst = resolve
			})
			const second = makeGroups(2)
			mockRpcClient.listByFollower
				.mockReturnValueOnce(firstRpc)
				.mockResolvedValueOnce(second)

			const firstCallPromise = sut.listByFollower()
			sut.invalidateFollowerCache()
			releaseFirst(makeGroups(1))
			await firstCallPromise

			// Next call MUST hit the RPC again — cache should be empty
			// because invalidation fenced the stale write.
			const result = await sut.listByFollower()
			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(2)
			expect(result).toEqual(second)
		})
	})

	describe('listByFollower — concurrent-call dedup', () => {
		it('coalesces two simultaneous signal-less callers onto one RPC', async () => {
			const groups = makeGroups(1)
			mockRpcClient.listByFollower.mockResolvedValueOnce(groups)

			const [a, b] = await Promise.all([
				sut.listByFollower(),
				sut.listByFollower(),
			])

			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(1)
			expect(a).toEqual(groups)
			expect(b).toEqual(groups)
		})

		it('does NOT dedup when callers provide AbortSignal (per-caller cancellation must be honored)', async () => {
			const groups = makeGroups(1)
			mockRpcClient.listByFollower.mockResolvedValue(groups)

			const ctrlA = new AbortController()
			const ctrlB = new AbortController()
			await Promise.all([
				sut.listByFollower(ctrlA.signal),
				sut.listByFollower(ctrlB.signal),
			])

			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(2)
		})

		it('does not coalesce a post-invalidation caller onto the pre-invalidation in-flight', async () => {
			// Reproduce the stale-coalesce window: an RPC is in flight,
			// invalidateFollowerCache() runs, then a second caller arrives
			// before the first RPC settles. The second caller MUST issue
			// its own RPC (not be coalesced onto the now-stale in-flight),
			// otherwise it would receive the stale payload for its render.
			let releaseFirst: (groups: ProximityGroup[]) => void = () => {}
			const firstRpc = new Promise<ProximityGroup[]>((resolve) => {
				releaseFirst = resolve
			})
			const fresh = makeGroups(2)
			mockRpcClient.listByFollower
				.mockReturnValueOnce(firstRpc)
				.mockResolvedValueOnce(fresh)

			const firstCall = sut.listByFollower()
			sut.invalidateFollowerCache()
			const secondCall = sut.listByFollower()
			releaseFirst(makeGroups(1))

			await firstCall
			expect(await secondCall).toEqual(fresh)
			expect(mockRpcClient.listByFollower).toHaveBeenCalledTimes(2)
		})
	})
})
