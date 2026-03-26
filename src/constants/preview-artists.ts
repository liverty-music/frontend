/**
 * Curated artist IDs for the Welcome page dashboard preview.
 * These are popular Japanese artists likely to have upcoming concerts.
 * The list is kept at 10-15 entries so that fetching stops as soon as
 * enough concerts are found (≥5 artists with upcoming events).
 *
 * Artist UUIDs differ per environment. Configure via VITE_PREVIEW_ARTIST_IDS
 * (comma-separated UUIDs) in the environment-specific `.env` file.
 */
function resolvePreviewArtistIds(): readonly string[] {
	const raw = import.meta.env.VITE_PREVIEW_ARTIST_IDS as string | undefined
	if (!raw) {
		if (import.meta.env.DEV) {
			console.warn(
				'[WelcomePreview] VITE_PREVIEW_ARTIST_IDS is not set. The welcome page preview will not display any concerts.',
			)
		}
		return []
	}
	return raw
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0)
}

export const PREVIEW_ARTIST_IDS: readonly string[] = resolvePreviewArtistIds()

/** Minimum number of artists with concerts required to show the preview. */
export const PREVIEW_MIN_ARTISTS_WITH_CONCERTS = 5
