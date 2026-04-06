import { beforeEach, describe, expect, it, vi } from 'vitest'
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

			vi.restoreAllMocks()
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
	})
})
