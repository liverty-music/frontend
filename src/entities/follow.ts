import type { Artist } from './artist'

/** Hype level indicating how far the user will travel for an artist. */
export type Hype = 'watch' | 'home' | 'nearby' | 'away'

/** Default hype level assigned to new follows and used as fallback. */
export const DEFAULT_HYPE: Hype = 'watch'

/**
 * A followed artist combining the proto Artist entity
 * with the user's hype setting.
 * Used for both authenticated (RPC-backed) and guest (localStorage-backed) follows.
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
