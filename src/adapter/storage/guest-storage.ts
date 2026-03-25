import type { GuestFollow } from '../../entities/follow'

const KEY_FOLLOWED = 'guest.followedArtists'
const KEY_HOME = 'guest.home'
const KEY_HYPES = 'liverty:guest:hypes'

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

export function saveHypes(hypes: Record<string, string>): void {
	localStorage.setItem(KEY_HYPES, JSON.stringify(hypes))
}

export function loadHypes(): Record<string, string> {
	const raw = localStorage.getItem(KEY_HYPES)
	if (!raw) return {}
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return {}
		const result: Record<string, string> = {}
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof k === 'string' && typeof v === 'string') {
				result[k] = v
			}
		}
		return result
	} catch {
		return {}
	}
}

export function clearHypes(): void {
	localStorage.removeItem(KEY_HYPES)
}

function isGuestFollow(val: unknown): val is GuestFollow {
	if (!val || typeof val !== 'object') return false
	const f = val as Record<string, unknown>
	if (!f.artist || typeof f.artist !== 'object') return false
	const a = f.artist as Record<string, unknown>
	return typeof a.id === 'string' && typeof a.name === 'string'
}
