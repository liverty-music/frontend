import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../entities/artist'
import { DEFAULT_HYPE, type FollowedArtist } from '../entities/follow'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockRpcClient = {
	listFollowed: vi.fn(async (): Promise<FollowedArtist[]> => []),
	follow: vi.fn(),
	unfollow: vi.fn(),
	setHype: vi.fn(),
}
const mockConcertService = {
	invalidateFollowerCache: vi.fn(),
}

// Guest follow queue is now hydrated from the guest-storage adapter on
// construction (GuestService is dissolved). Drive it via a mutable seed array
// that loadFollows returns and saveFollows mirrors back.
let guestSeed: FollowedArtist[] = []
const saveFollows = vi.fn((follows: FollowedArtist[]) => {
	guestSeed = [...follows]
})
vi.mock('../adapter/storage/guest-storage', () => ({
	loadFollows: vi.fn(() => [...guestSeed]),
	saveFollows: (follows: FollowedArtist[]) => saveFollows(follows),
}))

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: mockAuth,
				IFollowRpcClient: mockRpcClient,
				IConcertStore: mockConcertService,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

import { FollowServiceClient } from './follow-service-client'

function makeArtist(id: string, name: string): Artist {
	return { id, name } as Artist
}

function makeFollowedArtist(id: string, name: string): FollowedArtist {
	return { artist: makeArtist(id, name), hype: DEFAULT_HYPE }
}

describe('FollowServiceClient', () => {
	let sut: FollowServiceClient

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		guestSeed = []
		sut = new FollowServiceClient()
	})

	describe('follow — cache invalidation', () => {
		it('calls invalidateFollowerCache on successful follow', async () => {
			mockRpcClient.follow.mockResolvedValueOnce(undefined)
			const artist = makeArtist('a1', 'Artist One')

			await sut.follow(artist)

			expect(mockConcertService.invalidateFollowerCache).toHaveBeenCalledOnce()
		})

		it('does NOT call invalidateFollowerCache when follow RPC fails', async () => {
			mockRpcClient.follow.mockRejectedValueOnce(new Error('network error'))
			const artist = makeArtist('a1', 'Artist One')

			await expect(sut.follow(artist)).rejects.toThrow('network error')

			expect(mockConcertService.invalidateFollowerCache).not.toHaveBeenCalled()
		})
	})

	describe('unfollow — cache invalidation', () => {
		it('calls invalidateFollowerCache on successful unfollow', async () => {
			mockRpcClient.unfollow.mockResolvedValueOnce(undefined)
			// Seed followedArtists so the filter doesn't no-op into empty
			sut.followedArtists = [makeArtist('a1', 'Artist One')]

			await sut.unfollow('a1')

			expect(mockConcertService.invalidateFollowerCache).toHaveBeenCalledOnce()
		})

		it('does NOT call invalidateFollowerCache when unfollow RPC fails', async () => {
			mockRpcClient.unfollow.mockRejectedValueOnce(new Error('network error'))
			sut.followedArtists = [makeArtist('a1', 'Artist One')]

			await expect(sut.unfollow('a1')).rejects.toThrow('network error')

			expect(mockConcertService.invalidateFollowerCache).not.toHaveBeenCalled()
		})
	})

	describe('getFollowedArtistMap — always issues RPC (hype data not cached)', () => {
		it('calls listFollowed RPC when followedArtists is empty', async () => {
			mockRpcClient.listFollowed.mockResolvedValueOnce([
				makeFollowedArtist('a1', 'Artist One'),
			])

			await sut.getFollowedArtistMap()

			expect(mockRpcClient.listFollowed).toHaveBeenCalledTimes(1)
		})

		it('calls listFollowed RPC on each call (hype data lives in RPC response)', async () => {
			mockRpcClient.listFollowed.mockResolvedValue([
				makeFollowedArtist('a1', 'Artist One'),
			])
			// Even with followedArtists populated, listFollowed must be called
			// to retrieve per-artist hype values which are not stored in followedArtists.
			sut.followedArtists = [makeArtist('a1', 'Artist One')]

			await sut.getFollowedArtistMap()

			expect(mockRpcClient.listFollowed).toHaveBeenCalledTimes(1)
		})
	})

	describe('listFollowed', () => {
		it('sets followedArtists to the mapped Artist array when authenticated', async () => {
			mockRpcClient.listFollowed.mockResolvedValueOnce([
				makeFollowedArtist('a1', 'Artist One'),
				makeFollowedArtist('a2', 'Artist Two'),
			])

			await sut.listFollowed()

			expect(sut.followedArtists).toEqual([
				makeArtist('a1', 'Artist One'),
				makeArtist('a2', 'Artist Two'),
			])
		})

		it('sets followedArtists from guest storage follows when not authenticated', async () => {
			mockAuth.isAuthenticated = false
			guestSeed = [makeFollowedArtist('g1', 'Guest Artist')]
			// Reconstruct so the guest queue hydrates from the new seed.
			sut = new FollowServiceClient()

			await sut.listFollowed()

			expect(sut.followedArtists).toEqual([makeArtist('g1', 'Guest Artist')])
		})

		it('sets followedArtists to [] when result is empty', async () => {
			mockRpcClient.listFollowed.mockResolvedValueOnce([])
			sut.followedArtists = [makeArtist('stale', 'Stale Artist')]

			await sut.listFollowed()

			expect(sut.followedArtists).toEqual([])
		})
	})

	describe('guest follow queue (localStorage-backed)', () => {
		beforeEach(() => {
			mockAuth.isAuthenticated = false
		})

		it('persists a guest follow and exposes it via guestFollows', async () => {
			await sut.follow(makeArtist('g1', 'Guest One'))

			expect(sut.guestFollows.map((f) => f.artist.id)).toEqual(['g1'])
			expect(saveFollows).toHaveBeenCalled()
		})

		it('removeGuestFollows drains a batch in a single persist', async () => {
			guestSeed = [
				makeFollowedArtist('g1', 'One'),
				makeFollowedArtist('g2', 'Two'),
				makeFollowedArtist('g3', 'Three'),
			]
			sut = new FollowServiceClient()

			sut.removeGuestFollows(['g1', 'g3'])

			expect(sut.guestFollows.map((f) => f.artist.id)).toEqual(['g2'])
			expect(saveFollows).toHaveBeenCalledTimes(1)
		})

		it('clearGuestFollows empties the persisted queue', async () => {
			guestSeed = [makeFollowedArtist('g1', 'One')]
			sut = new FollowServiceClient()

			sut.clearGuestFollows()

			expect(sut.guestFollows).toHaveLength(0)
		})

		it('setHype persists a guest hype change', async () => {
			guestSeed = [makeFollowedArtist('g1', 'One')]
			sut = new FollowServiceClient()

			await sut.setHype('g1', 'away')

			expect(sut.guestFollows[0]?.hype).toBe('away')
			expect(mockRpcClient.setHype).not.toHaveBeenCalled()
		})
	})
})
