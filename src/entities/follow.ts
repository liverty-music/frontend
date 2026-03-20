import type { Artist } from './artist'

/** Hype level indicating how far the user will travel for an artist. */
export type Hype = 'watch' | 'home' | 'nearby' | 'away'

/**
 * A guest (unauthenticated) follow stored locally during onboarding.
 * Paired with a nullable home area for proximity-based concert search.
 */
export interface GuestFollow {
	artist: Artist
	home: string | null
}

/**
 * A followed artist combining the proto Artist entity
 * with the user's hype setting.
 */
export interface FollowedArtist {
	artist: Artist
	hype: Hype
}

/**
 * Check whether an artist is already in a follow list.
 * Enforces the invariant that a user cannot follow the same artist twice.
 */
export function hasFollow(
	follows: ReadonlyArray<{ artist: { id: string } }>,
	artistId: string,
): boolean {
	return follows.some((f) => f.artist.id === artistId)
}
