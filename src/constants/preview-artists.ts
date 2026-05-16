import { getAppConfig } from '../config/app-config'

/**
 * Curated artist IDs and names for the Welcome page dashboard preview.
 * Sourced from the runtime AppConfig (`/config.json` `previewArtistIds`
 * + `previewArtistNames`).
 *
 * Exposed as functions rather than module-level constants so that
 * module evaluation does not require `loadAppConfig()` to have
 * resolved. Earlier versions performed the resolution at module-eval
 * time, which silently coupled module ordering to chunk-split topology
 * — Storybook stories or test imports that touched this module before
 * bootstrap would crash. The function form makes the dependency
 * explicit and lazy.
 */

interface PreviewArtists {
	readonly ids: readonly string[]
	readonly nameMap: ReadonlyMap<string, string>
}

let _cache: PreviewArtists | null = null

function resolvePreviewArtists(): PreviewArtists {
	if (_cache) return _cache
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

	_cache = { ids, nameMap }
	return _cache
}

/** Returns the curated artist IDs from the runtime AppConfig. */
export function getPreviewArtistIds(): readonly string[] {
	return resolvePreviewArtists().ids
}

/** Returns the curated artist ID → display name map. */
export function getPreviewArtistNameMap(): ReadonlyMap<string, string> {
	return resolvePreviewArtists().nameMap
}

/** Minimum number of artists with concerts required to show the preview. */
export const PREVIEW_MIN_ARTISTS_WITH_CONCERTS = 5

/** Test-only: clear the cached resolution so each unit test starts fresh. */
export function __resetPreviewArtistsForTests(): void {
	_cache = null
}
