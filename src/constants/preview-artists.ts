/**
 * Curated artist IDs and names for the Welcome page dashboard preview.
 * These are popular Japanese artists likely to have upcoming concerts.
 *
 * Both VITE_PREVIEW_ARTIST_IDS and VITE_PREVIEW_ARTIST_NAMES must be
 * comma-separated lists in the same order. Configure in the
 * environment-specific `.env` file.
 */

function parseEnvList(key: string): readonly string[] {
	const raw = import.meta.env[key] as string | undefined
	if (!raw) return []
	return raw
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v.length > 0)
}

function resolvePreviewArtists(): {
	ids: readonly string[]
	nameMap: ReadonlyMap<string, string>
} {
	const ids = parseEnvList('VITE_PREVIEW_ARTIST_IDS')
	const names = parseEnvList('VITE_PREVIEW_ARTIST_NAMES')

	if (ids.length === 0 && import.meta.env.DEV) {
		console.warn(
			'[WelcomePreview] VITE_PREVIEW_ARTIST_IDS is not set. The welcome page preview will not display any concerts.',
		)
	}

	const nameMap = new Map<string, string>()
	for (let i = 0; i < ids.length; i++) {
		nameMap.set(ids[i], names[i] ?? '')
	}

	return { ids, nameMap }
}

const preview = resolvePreviewArtists()

export const PREVIEW_ARTIST_IDS: readonly string[] = preview.ids
export const PREVIEW_ARTIST_NAME_MAP: ReadonlyMap<string, string> =
	preview.nameMap

/** Minimum number of artists with concerts required to show the preview. */
export const PREVIEW_MIN_ARTISTS_WITH_CONCERTS = 5
