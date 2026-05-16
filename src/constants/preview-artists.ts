import { getAppConfig } from '../config/app-config'

/**
 * Curated artist IDs and names for the Welcome page dashboard preview.
 * Sourced from the runtime AppConfig (`/config.json` previewArtistIds /
 * previewArtistNames). This module evaluates inside the lazy welcome-route
 * chunk, which is only instantiated after bootstrap has resolved
 * `loadAppConfig()`; reading via `getAppConfig()` here is safe.
 */
function resolvePreviewArtists(): {
	ids: readonly string[]
	nameMap: ReadonlyMap<string, string>
} {
	const config = getAppConfig()
	const ids = config.previewArtistIds
	const names = config.previewArtistNames

	if (ids.length === 0 && import.meta.env.DEV) {
		console.warn(
			'[WelcomePreview] config.previewArtistIds is empty. The welcome page preview will not display any concerts.',
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
