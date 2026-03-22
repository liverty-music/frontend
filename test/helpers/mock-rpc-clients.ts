import { vi } from 'vitest'
import type { IArtistServiceClient } from '../../src/services/artist-service-client'
import type { IAuthService } from '../../src/services/auth-service'
import type { IConcertService } from '../../src/services/concert-service'
import type { IFollowServiceClient } from '../../src/services/follow-service-client'
import type { IUserService } from '../../src/services/user-service'

/**
 * Creates a mock implementation of IConcertService for testing.
 */
export function createMockConcertService(): Partial<IConcertService> {
	return {
		artistsWithConcerts: new Set<string>(),
		artistsWithConcertsCount: 0,
		listConcerts: vi.fn().mockResolvedValue([]),
		listByFollower: vi.fn().mockResolvedValue([]),
		searchNewConcerts: vi.fn().mockResolvedValue(undefined),
		addArtistWithConcerts: vi.fn(),
	}
}

/**
 * Creates a mock implementation of IArtistServiceClient for testing.
 */
export function createMockArtistServiceClient(): Partial<IArtistServiceClient> {
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
 * Creates a mock implementation of IFollowServiceClient for testing.
 */
export function createMockFollowServiceClient(): Partial<IFollowServiceClient> {
	return {
		followedArtists: [],
		followedIds: new Set<string>(),
		followedCount: 0,
		hydrate: vi.fn(),
		listFollowed: vi.fn().mockResolvedValue([]),
		follow: vi.fn().mockResolvedValue(undefined),
		unfollow: vi.fn().mockResolvedValue(undefined),
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

/**
 * Creates a mock implementation of IUserService for testing.
 */
export function createMockUserService(): Partial<IUserService> {
	return {
		client: {
			get: vi.fn().mockResolvedValue({ user: undefined }),
			updateHome: vi.fn().mockResolvedValue({}),
			create: vi.fn().mockResolvedValue({}),
		} as unknown as IUserService['client'],
		updateHome: vi.fn().mockResolvedValue(undefined),
	}
}
