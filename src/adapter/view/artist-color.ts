import type { LogoColorProfile } from '../../entities/artist'

const SATURATION = 65
const LIGHTNESS = 60

/**
 * Compute a deterministic hue (0-359) from an artist name.
 */
export function artistHue(name: string): number {
	let hash = 0
	for (const char of name) {
		hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
	}
	return ((hash % 360) + 360) % 360
}

/**
 * Compute a deterministic HSL color string from an artist name.
 */
export function artistColor(name: string): string {
	return `hsl(${artistHue(name)}, ${SATURATION}%, ${LIGHTNESS}%)`
}

/**
 * Returns the hue to use for an artist card background.
 * Chromatic logos use their dominant hue; achromatic logos fall back to the
 * name-hash to preserve color variety across the dashboard.
 */
export function artistHueFromColorProfile(
	profile: LogoColorProfile | undefined,
	artistName: string,
): number {
	if (profile?.isChromatic && profile.dominantHue != null) {
		return profile.dominantHue
	}
	return artistHue(artistName)
}
