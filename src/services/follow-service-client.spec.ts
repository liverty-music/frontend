import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../entities/artist'
import type { FollowedArtist } from '../entities/follow'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockGuest = { follows: [] as { artist: Artist }[] }
const mockRpcClient = {
	listFollowed: vi.fn(async (): Promise<FollowedArtist[]> => []),
	follow: vi.fn(),
	unfollow: vi.fn(),
	setHype: vi.fn(),
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
				IFollowRpcClient: mockRpcClient,
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
	return { artist: makeArtist(id, name), hype: 'watch' as const }
}

describe('FollowServiceClient', () => {
	let sut: FollowServiceClient

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockGuest.follows = []
		sut = new FollowServiceClient()
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
			mockGuest.follows = [{ artist: makeArtist('g1', 'Guest Artist') }]

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
})
