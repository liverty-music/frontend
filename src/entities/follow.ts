import type { Artist } from './artist'

/** Hype level indicating how far the user will travel for an artist. */
export type Hype = 'watch' | 'home' | 'nearby' | 'away'

/**
 * A followed artist combining the proto Artist entity
 * with the user's hype setting.
 */
export interface FollowedArtist {
	artist: Artist
	hype: Hype
}
