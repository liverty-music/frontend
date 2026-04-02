import { DEFAULT_HYPE, type FollowedArtist } from '../../entities/follow'

const KEY_FOLLOWED = 'guest.followedArtists'
const KEY_HOME = 'guest.home'

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
