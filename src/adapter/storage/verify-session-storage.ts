/**
 * Persistence adapter for the in-flight PocketSign Stamp verify session.
 *
 * When the fan taps "verify identity" the service calls StartVerify, receives a
 * session_id + redirect_url, stores the session_id here, and immediately
 * navigates the browser to the redirect_url to open the PocketSign app. Because
 * the browser navigates away (full-page redirect), the session_id must survive
 * across the navigation and be available when the PocketSign app returns the fan
 * to our callback route.
 *
 * sessionStorage is NOT used (it is scoped to the current tab/frame and is
 * cleared when the top-level document navigates to a different origin). The
 * callback arrives in the same tab on the same origin after a same-origin
 * redirect, so sessionStorage would survive there — but the PocketSign app
 * returns via a custom URL scheme / app link that may open a fresh tab on some
 * platforms, which would clear sessionStorage. localStorage is the safe choice.
 *
 * Key lifetime: written at StartVerify, read+deleted at CompleteVerify (or on a
 * mis-matched / error callback). A stale key (e.g. the fan closed the app
 * without completing) is harmless — the backend session expires independently.
 */

const LS_KEY = 'liverty:verify:sessionId'

/**
 * Persist the Stamp session id before redirecting to the PocketSign app.
 * Returns `true` iff the write succeeded (a SecurityError in private-mode
 * Safari or a sandboxed iframe is caught and returns `false`; the flow still
 * continues — the callback will show an error on mis-match, which is the
 * correct safe-failure mode).
 */
export function saveVerifySessionId(sessionId: string): boolean {
	try {
		localStorage.setItem(LS_KEY, sessionId)
		return true
	} catch {
		return false
	}
}

/**
 * Read the persisted Stamp session id. Returns `null` when absent or when
 * localStorage is unavailable.
 */
export function loadVerifySessionId(): string | null {
	try {
		return localStorage.getItem(LS_KEY)
	} catch {
		return null
	}
}

/**
 * Remove the persisted session id. Called after CompleteVerify (success or
 * failure) so the callback cannot be replayed by re-navigating to the URL.
 */
export function clearVerifySessionId(): void {
	try {
		localStorage.removeItem(LS_KEY)
	} catch {
		/* best-effort */
	}
}
