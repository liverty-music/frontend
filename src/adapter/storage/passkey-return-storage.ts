/**
 * The marker that brings the fan back to passkey management after adding a
 * passkey in the hosted login (OpenSpec change
 * `fan-passkey-recovery-and-management`, design D4).
 *
 * The hosted login ends a passkey registration on its default redirect, the
 * fan app root, which knows nothing about where the fan came from. The app
 * writes this marker right before leaving for the hosted login, and the root
 * route consumes it on the way back.
 *
 * sessionStorage: the round trip happens in the same tab, and the marker must
 * not outlive it. The value carries an expiry so a marker left by an abandoned
 * registration cannot hijack a later, unrelated visit to the root.
 */

import { isInAppPath } from '../../../shared/services/auth-service'

const SS_KEY = 'passkeys.returnTo'

/** A marker older than this is ignored. */
export const PASSKEY_RETURN_TTL_MS = 10 * 60 * 1000

/** Remember to return to `path` once the hosted login sends the fan back. */
export function savePasskeyReturn(path: string): void {
	try {
		sessionStorage.setItem(
			SS_KEY,
			JSON.stringify({ loc: path, exp: Date.now() + PASSKEY_RETURN_TTL_MS }),
		)
	} catch {
		// Storage unavailable: the fan lands on the app root instead.
	}
}

/**
 * Read and clear the marker. Returns null when none is stored, it is
 * malformed or it has expired.
 */
export function takePasskeyReturn(): string | null {
	try {
		const raw = sessionStorage.getItem(SS_KEY)
		if (!raw) return null
		sessionStorage.removeItem(SS_KEY)
		const { loc, exp } = JSON.parse(raw) as { loc?: unknown; exp?: unknown }
		if (!isInAppPath(loc) || typeof exp !== 'number') return null
		if (Date.now() > exp) return null
		return loc
	} catch {
		return null
	}
}
