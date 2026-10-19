import type { Artist } from '../../entities/artist'

const KEY = 'follow.keptArtists'

interface KeptFollows {
	/** The OIDC subject the list belongs to. */
	sub: string
	artists: Pick<Artist, 'id' | 'name' | 'mbid'>[]
}

/**
 * Keep the signed-in fan's followed artists from the last follow-list load, so
 * the next start can choose Discovery's seeds without waiting for the list.
 * Only identity fields are kept; the list is a hint, not the follow state.
 */
export function saveKeptFollows(sub: string, artists: readonly Artist[]): void {
	const kept: KeptFollows = {
		sub,
		artists: artists.map(({ id, name, mbid }) => ({
			id,
			name,
			mbid: mbid ?? '',
		})),
	}
	try {
		localStorage.setItem(KEY, JSON.stringify(kept))
	} catch {
		// Storage full or unavailable: the next start waits for the list.
	}
}

/** The artists kept for `sub`, or an empty list (none kept, other account, corrupt). */
export function loadKeptFollows(sub: string): Artist[] {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw) as Partial<KeptFollows>
		if (parsed.sub !== sub || !Array.isArray(parsed.artists)) return []
		return parsed.artists.flatMap((a) =>
			typeof a?.id === 'string' && typeof a.name === 'string'
				? [{ id: a.id, name: a.name, mbid: String(a.mbid ?? '') }]
				: [],
		)
	} catch {
		return []
	}
}

export function clearKeptFollows(): void {
	try {
		localStorage.removeItem(KEY)
	} catch {
		// Nothing to clear.
	}
}
