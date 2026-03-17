/** Hype level indicating how far the user will travel for an artist. */
export type Hype = 'watch' | 'home' | 'nearby' | 'away'

/** Dominant color characteristics of an artist's logo image. */
export interface LogoColorProfile {
	dominantHue?: number
	dominantLightness: number
	isChromatic: boolean
}

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
	logoColorProfile?: LogoColorProfile
}
