import { vi } from 'vitest'
import type { IArtistStore } from '../../src/services/artist-store'
import type { IAuthService } from '../../src/services/auth-service'
import type { IConcertStore } from '../../src/services/concert-store'
import type { IFollowStore } from '../../src/services/follow-store'

/**
 * Creates a mock implementation of IConcertStore for testing.
 */
export function createMockConcertService(): Partial<IConcertStore> {
	return {
		artistsWithConcerts: new Set<string>(),
		artistsWithConcertsCount: 0,
		listConcerts: vi.fn().mockResolvedValue([]),
		listByFollower: vi.fn().mockResolvedValue([]),
		addArtistWithConcerts: vi.fn(),
	}
}

/**
 * Creates a mock implementation of IArtistStore for testing.
 */
export function createMockArtistServiceClient(): Partial<IArtistStore> {
	return {
		listTop: vi.fn().mockResolvedValue([]),
		listSimilar: vi.fn().mockResolvedValue([]),
		search: vi.fn().mockResolvedValue([]),
		getClient: vi.fn().mockReturnValue({
			getTopArtists: vi.fn().mockResolvedValue({ artists: [] }),
			getSimilarArtists: vi.fn().mockResolvedValue({ artists: [] }),
		}),
	}
}

/**
 * Creates a mock implementation of IFollowStore for testing.
 */
export function createMockFollowStore(): Partial<IFollowStore> {
	return {
		followedArtists: [],
		followedIds: new Set<string>(),
		followedCount: 0,
		// FollowServiceClient now owns the persisted guest follow queue
		// (GuestService dissolved); expose an empty default so consumers reading
		// `guestFollows` during onboarding don't throw.
		guestFollows: [],
		hydrate: vi.fn(),
		listFollowed: vi.fn().mockResolvedValue([]),
		follow: vi.fn().mockResolvedValue(undefined),
		unfollow: vi.fn().mockResolvedValue(undefined),
		setHype: vi.fn().mockResolvedValue(undefined),
	}
}

/**
 * Creates a mock implementation of IAuthService for testing.
 * Defaults to unauthenticated (guest) state.
 */
export function createMockAuthService(): Partial<IAuthService> {
	return {
		isAuthenticated: false,
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined),
	}
}
