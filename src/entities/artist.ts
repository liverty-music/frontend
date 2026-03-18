export {
	Artist,
	Fanart,
	LogoColorProfile,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'

import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'

/**
 * Extract the best logo URL from an artist's fanart.
 * Prefers HD music logo, falls back to standard music logo.
 */
export function bestLogoUrl(artist: Artist | undefined): string | undefined {
	const fanart = artist?.fanart
	return fanart?.hdMusicLogo?.value ?? fanart?.musicLogo?.value
}

/**
 * Extract the best background URL from an artist's fanart.
 */
export function bestBackgroundUrl(
	artist: Artist | undefined,
): string | undefined {
	return artist?.fanart?.artistBackground?.value
}
