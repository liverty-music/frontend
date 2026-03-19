/**
 * A musical artist or group recorded in the system.
 * @source proto/liverty_music/entity/v1/artist.proto — Artist
 */
export interface Artist {
	readonly id: string
	readonly name: string
	readonly mbid: string
	readonly fanart?: ArtistFanart
}

/**
 * Community-curated artist images from fanart.tv.
 * @source proto/liverty_music/entity/v1/artist.proto — Fanart
 */
export interface ArtistFanart {
	readonly artistThumb?: string
	readonly artistBackground?: string
	readonly hdMusicLogo?: string
	readonly musicLogo?: string
	readonly musicBanner?: string
	readonly logoColorProfile?: LogoColorProfile
}

/**
 * Dominant color characteristics of an artist's logo image.
 * @source proto/liverty_music/entity/v1/artist.proto — LogoColorProfile
 */
export interface LogoColorProfile {
	readonly dominantHue?: number
	readonly dominantLightness: number
	readonly isChromatic: boolean
}

/**
 * Extract the best logo URL from an artist's fanart.
 * Prefers HD music logo, falls back to standard music logo.
 */
export function bestLogoUrl(artist: Artist | undefined): string | undefined {
	const fanart = artist?.fanart
	return fanart?.hdMusicLogo ?? fanart?.musicLogo
}

/**
 * Extract the best background URL from an artist's fanart.
 */
export function bestBackgroundUrl(
	artist: Artist | undefined,
): string | undefined {
	return artist?.fanart?.artistBackground
}
