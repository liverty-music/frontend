/**
 * A musical artist or group recorded in the system.
 * @source proto/liverty_music/entity/v1/artist.proto — Artist
 */
export interface Artist {
	readonly id: string
	readonly name: string
	readonly mbid: string
	readonly fanart?: ArtistFanart
	/** Prototype-only flag: marks a placeholder bubble shown during loading. */
	readonly isGhost?: true
}

/**
 * A followed artist projected with the count of its upcoming concerts in the
 * loaded dashboard set — drives the count-prefixed, count-sorted filter chips.
 */
export interface CountedArtist {
	id: string
	name: string
	count: number
}

/**
 * Community-curated artist images from fanart.tv.
 * @source proto/liverty_music/entity/v1/artist.proto — Fanart
 */
export interface ArtistFanart {
	readonly artistThumb?: string
	readonly artistBackground?: string
	readonly musicBanner?: string
}

/**
 * Extract the best background URL from an artist's fanart.
 */
export function bestBackgroundUrl(
	artist: Artist | undefined,
): string | undefined {
	return artist?.fanart?.artistBackground
}
