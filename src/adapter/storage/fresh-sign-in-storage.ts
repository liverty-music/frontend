/**
 * The marker of a fresh sign-in in progress (OpenSpec change
 * `delete-fan-accounts`, design D4): which screen started it.
 *
 * A fan who leaves the hosted login without signing in (browser back, or the
 * hosted login's own back action) comes back to that screen without passing
 * the callback route, so the screen cannot tell from the fresh sign-in's
 * in-memory tokens alone that it asked. It reads this marker instead and says
 * the action did not happen.
 *
 * sessionStorage: the round trip happens in the same tab, and the marker must
 * not outlive it. The value carries an expiry so a marker left by an abandoned
 * sign-in cannot speak for a later, unrelated visit.
 */

const SS_KEY = 'freshSignIn.started'

/** A marker older than this is ignored. */
export const FRESH_SIGN_IN_START_TTL_MS = 10 * 60 * 1000

/** Remember that a fresh sign-in was started for `screen`. */
export function saveFreshSignInStart(screen: string): void {
	try {
		sessionStorage.setItem(
			SS_KEY,
			JSON.stringify({
				screen,
				exp: Date.now() + FRESH_SIGN_IN_START_TTL_MS,
			}),
		)
	} catch {
		// Storage unavailable: an abandoned sign-in is then not reported.
	}
}

/**
 * Read and clear the marker. Returns the screen that started the sign-in, or
 * null when none is stored, it is malformed or it has expired.
 */
export function takeFreshSignInStart(): string | null {
	const screen = peekFreshSignInStart()
	try {
		sessionStorage.removeItem(SS_KEY)
	} catch {
		// Storage unavailable: nothing was stored either.
	}
	return screen
}

/** Read the marker without clearing it; null as {@link takeFreshSignInStart}. */
export function peekFreshSignInStart(): string | null {
	try {
		const raw = sessionStorage.getItem(SS_KEY)
		if (!raw) return null
		const { screen, exp } = JSON.parse(raw) as {
			screen?: unknown
			exp?: unknown
		}
		if (typeof screen !== 'string' || typeof exp !== 'number') return null
		if (Date.now() > exp) return null
		return screen
	} catch {
		return null
	}
}
