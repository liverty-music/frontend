import type { Artist } from './artist'

/** Hype level indicating how far the user will travel for an artist. */
export type Hype = 'watch' | 'home' | 'nearby' | 'away'

/**
 * Default hype level assigned to new follows and used as fallback.
 *
 * Set to `'nearby'` so a fresh follow immediately implies "notify me about
 * concerts within reach of my home area." The non-dismissable signup banner
 * (see `signup-prompt-banner` capability) makes the signup prerequisite for
 * actually receiving these notifications visible from the moment a guest
 * lands on the My Artists page.
 */
export const DEFAULT_HYPE: Hype = 'nearby'

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
 * Who set a guest's hype level: `default` is the level a new follow starts at,
 * `fan` is a level the guest chose (even when it equals the default). Carried
 * into the account at sign-up, so a chosen level counts as the fan's own.
 */
export type GuestHypeSetBy = 'default' | 'fan'

/** A guest's follow kept on the device, with who set its hype level. */
export interface GuestFollowedArtist extends FollowedArtist {
	hypeSetBy: GuestHypeSetBy
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
