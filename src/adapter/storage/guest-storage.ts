import type { GuestFollow } from '../../entities/follow'

const KEY_FOLLOWED = 'guest.followedArtists'
const KEY_HOME = 'guest.home'

export function saveFollows(follows: GuestFollow[]): void {
	localStorage.setItem(KEY_FOLLOWED, JSON.stringify(follows))
}

export function loadFollows(): GuestFollow[] {
	const raw = localStorage.getItem(KEY_FOLLOWED)
	if (!raw) return []
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(isGuestFollow)
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

function isGuestFollow(val: unknown): val is GuestFollow {
	if (!val || typeof val !== 'object') return false
	const f = val as Record<string, unknown>
	if (!f.artist || typeof f.artist !== 'object') return false
	const a = f.artist as Record<string, unknown>
	return typeof a.id === 'string' && typeof a.name === 'string'
}
