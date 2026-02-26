import { vi } from 'vitest'
import type { IArtistDiscoveryService } from '../../src/services/artist-discovery-service'
import type { IArtistServiceClient } from '../../src/services/artist-service-client'
import type { IConcertService } from '../../src/services/concert-service'

/**
 * Creates a mock implementation of IConcertService for testing.
 */
export function createMockConcertService(): Partial<IConcertService> {
	return {
		listConcerts: vi.fn().mockResolvedValue([]),
		listByFollower: vi.fn().mockResolvedValue([]),
		searchNewConcerts: vi.fn().mockResolvedValue(undefined),
	}
}

/**
 * Creates a mock implementation of IArtistServiceClient for testing.
 */
export function createMockArtistServiceClient(): Partial<IArtistServiceClient> {
	return {
		listFollowed: vi.fn().mockResolvedValue([]),
		follow: vi.fn().mockResolvedValue(undefined),
		unfollow: vi.fn().mockResolvedValue(undefined),
		getClient: vi.fn().mockReturnValue({
			listFollowed: vi.fn().mockResolvedValue({ artists: [] }),
			getTopArtists: vi.fn().mockResolvedValue({ artists: [] }),
			getSimilarArtists: vi.fn().mockResolvedValue({ artists: [] }),
			followArtist: vi.fn().mockResolvedValue({}),
			unfollow: vi.fn().mockResolvedValue({}),
			setPassionLevel: vi.fn().mockResolvedValue({}),
		}),
	}
}

/**
 * Creates a mock implementation of IArtistDiscoveryService for testing.
 */
export function createMockArtistDiscoveryService(): Partial<IArtistDiscoveryService> {
	return {
		availableBubbles: [],
		followedArtists: [],
		orbIntensity: 0,
		loadInitialArtists: vi.fn().mockResolvedValue(undefined),
		followArtist: vi.fn().mockResolvedValue(undefined),
		getSimilarArtists: vi.fn().mockResolvedValue([]),
		checkLiveEvents: vi.fn().mockResolvedValue(false),
		listFollowedFromBackend: vi.fn().mockResolvedValue([]),
	}
}
