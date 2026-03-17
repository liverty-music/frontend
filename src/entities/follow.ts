/** Hype level indicating how far the user will travel for an artist. */
export type Hype = 'watch' | 'home' | 'nearby' | 'away'

/**
 * A followed artist with flattened fields from the proto response.
 * Combines artist identity with the user's hype setting and
 * pre-resolved fanart URLs needed by UI components.
 */
export interface FollowedArtist {
	id: string
	name: string
	hype: Hype
	logoUrl?: string
	backgroundUrl?: string
}
