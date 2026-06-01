import { DEFAULT_HYPE, type FollowedArtist } from '../../entities/follow'
import { normalizeToSupportedLanguage } from '../../util/change-locale'

const KEY_FOLLOWED = 'guest.followedArtists'
const KEY_HOME = 'guest.home'
// Anonymous-period UI language. Dedicated key, DECOUPLED from the i18next
// detector's own cache key (`StorageKeys.language === 'language'`, configured
// in main.ts as `lookupLocalStorage`). UserStore is the sole reader/writer
// of `guest.language`, so clearing the guest slice cannot erase the detector's
// active-locale cache, and a returning guest who never made an explicit choice keeps
// `guest.language === null` (the detector's auto-written 'language' no longer
// leaks in) — preserving the "null → reactive i18nLocale fallback" contract.
const KEY_LANGUAGE = 'guest.language'

export function saveFollows(follows: FollowedArtist[]): void {
	localStorage.setItem(KEY_FOLLOWED, JSON.stringify(follows))
}

export function loadFollows(): FollowedArtist[] {
	const raw = localStorage.getItem(KEY_FOLLOWED)
	if (!raw) return []
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.flatMap((item) => {
			const follow = toFollowedArtist(item)
			return follow ? [follow] : []
		})
	} catch {
		return []
	}
}

export function saveHome(code: string | null): void {
	if (code !== null) {
		localStorage.setItem(KEY_HOME, code)
	} else {
		localStorage.removeItem(KEY_HOME)
	}
}

export function loadHome(): string | null {
	return localStorage.getItem(KEY_HOME)
}

/**
 * Persist the guest's anonymous-period language. A `null` clears the key
 * (used on sign-up/sign-out when the DB or a fresh session takes over).
 */
export function saveLanguage(lang: string | null): void {
	if (lang !== null) {
		localStorage.setItem(KEY_LANGUAGE, lang)
	} else {
		localStorage.removeItem(KEY_LANGUAGE)
	}
}

/**
 * Load the guest's anonymous-period language. Returns `null` when the key is
 * absent so the store can fall back to the active i18n locale. A stored value
 * is normalized through `normalizeToSupportedLanguage` so a BCP 47 tag the
 * i18next detector may have written (e.g. 'en-US') resolves to a supported
 * code ('en') — otherwise selection-state comparisons against 'en' would fail.
 */
export function loadLanguage(): string | null {
	const raw = localStorage.getItem(KEY_LANGUAGE)
	if (raw === null) return null
	return normalizeToSupportedLanguage(raw)
}

/**
 * Coerce a stored value to FollowedArtist.
 * Accepts both the new format { artist, hype } and the legacy GuestFollow
 * format { artist, home } — legacy entries fall back to DEFAULT_HYPE.
 */
function toFollowedArtist(val: unknown): FollowedArtist | null {
	if (!val || typeof val !== 'object') return null
	const f = val as Record<string, unknown>
	if (!f.artist || typeof f.artist !== 'object') return null
	const a = f.artist as Record<string, unknown>
	if (typeof a.id !== 'string' || typeof a.name !== 'string') return null

	const hype =
		typeof f.hype === 'string' &&
		['watch', 'home', 'nearby', 'away'].includes(f.hype)
			? (f.hype as FollowedArtist['hype'])
			: DEFAULT_HYPE

	return { artist: f.artist as FollowedArtist['artist'], hype }
}
