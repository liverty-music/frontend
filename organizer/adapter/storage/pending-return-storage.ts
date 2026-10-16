/**
 * Persistence adapter for the console address a visitor opened on a device
 * that knows no Organization (design D4). The console shows the find-organizer
 * screen instead; the sign-in link from the email opens `/?org=<short name>`,
 * usually in another tab, so the address is kept in localStorage (not
 * sessionStorage) to return the visitor to it once they sign in.
 *
 * Bounded by a time limit so an address left by an abandoned attempt does not
 * hijack a later, unrelated sign-in.
 */

const KEY = 'organizer.pendingReturn'

/** A remembered address older than this is ignored (one day, in milliseconds). */
export const PENDING_RETURN_TTL_MS = 24 * 60 * 60 * 1000

/** Remember the address to return to after a sign-in through a link. */
export function savePendingReturn(path: string, now = Date.now()): void {
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({ path, exp: now + PENDING_RETURN_TTL_MS }),
		)
	} catch {
		// Private mode or blocked storage: the visitor lands on Home instead.
	}
}

/**
 * Takes the remembered address, if any and not expired, and forgets it.
 * Returns null for a missing, malformed or expired entry.
 */
export function takePendingReturn(now = Date.now()): string | null {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return null
		localStorage.removeItem(KEY)
		const { path, exp } = JSON.parse(raw) as { path?: unknown; exp?: unknown }
		if (typeof path !== 'string' || typeof exp !== 'number') return null
		return now > exp ? null : path
	} catch {
		return null
	}
}
