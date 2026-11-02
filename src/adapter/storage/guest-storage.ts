import {
	DEFAULT_HYPE,
	type FollowedArtist,
	type GuestFollowedArtist,
} from '../../entities/follow'

const KEY_FOLLOWED = 'guest.followedArtists'
const KEY_HOME = 'guest.home'

export function saveFollows(follows: readonly GuestFollowedArtist[]): void {
	localStorage.setItem(KEY_FOLLOWED, JSON.stringify(follows))
}

export function loadFollows(): GuestFollowedArtist[] {
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
 * Coerce a stored value to a guest follow.
 * Accepts the current format { artist, hype, hypeSetBy }, the earlier
 * { artist, hype } and the legacy GuestFollow format { artist, home }. A
 * missing hype falls back to DEFAULT_HYPE. A missing hypeSetBy counts as set by
 * the fan when the hype differs from DEFAULT_HYPE (a level other than the
 * starting one can only have been chosen), else as set by default, matching
 * the server's backfill.
 */
function toFollowedArtist(val: unknown): GuestFollowedArtist | null {
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

	const hypeSetBy =
		f.hypeSetBy === 'fan' || f.hypeSetBy === 'default'
			? f.hypeSetBy
			: hype === DEFAULT_HYPE
				? 'default'
				: 'fan'

	return { artist: f.artist as FollowedArtist['artist'], hype, hypeSetBy }
}
