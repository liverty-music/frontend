/**
 * Persistence adapter for the per-purpose analytics opt-out state. Every
 * `localStorage` access for opt-out state goes through this module so the
 * ConsentService stays portable to a different backing store (IndexedDB,
 * server-mirrored profile, etc.) without changing service code.
 *
 * Versioning: the persisted record carries a `version` discriminator so a
 * future schema change can tell its payloads apart. There is no migration from
 * the earlier v1 opt-in record: it was deleted before launch (OpenSpec
 * `referral-attribution`, design D9).
 */

import type { ConsentState } from '../../lib/consent/consent-service'

const LS_KEY_STATE = 'consent.state'

/**
 * Persisted v2 shape on `localStorage`. `version` is the forward-compat
 * seam: a future change bumps this and adds a migration branch in
 * `loadConsentState`. Note the opt-out model carries NO `decidedAt`: there
 * is no statutory consent record to timestamp — the default is on and the
 * user simply opts out at will.
 */
export type StoredConsentStateV2 = {
	version: 2
	analytics: boolean
	sessionReplay: boolean
}

/**
 * Reads and validates the persisted opt-out state. Returns `null` when nothing has been written yet OR
 * when the stored blob is corrupt / schema-mismatched (the caller then
 * applies the default-on posture). Corrupt blobs are removed in place so the
 * warning surface does not repeat on every subsequent boot. SecurityErrors
 * (privacy-mode Safari, sandboxed iframes) are caught — the caller sees
 * `null` and continues with defaults.
 */
export function loadConsentState(): StoredConsentStateV2 | null {
	let raw: string | null
	try {
		raw = localStorage.getItem(LS_KEY_STATE)
	} catch {
		return null
	}

	if (raw === null) return null

	const parsed = safeParseV2(raw)
	if (parsed === null) {
		try {
			localStorage.removeItem(LS_KEY_STATE)
		} catch {
			/* best-effort cleanup */
		}
		return null
	}
	return parsed
}

/**
 * Writes the opt-out state. Throws on `SecurityError` are swallowed so a
 * failed persist never crashes the in-memory flow — the caller's logger
 * surfaces the issue. Returns `true` iff the write succeeded.
 */
export function saveConsentState(state: ConsentState): boolean {
	const payload: StoredConsentStateV2 = {
		version: 2,
		analytics: state.analytics,
		sessionReplay: state.sessionReplay,
	}
	try {
		localStorage.setItem(LS_KEY_STATE, JSON.stringify(payload))
		return true
	} catch {
		return false
	}
}

/**
 * Removes the stored key. Provided for completeness and for tests; not
 * called from the production code path. A future "reset all preferences"
 * settings action would call this.
 */
export function clearConsentStorage(): void {
	try {
		localStorage.removeItem(LS_KEY_STATE)
	} catch {
		/* best-effort cleanup */
	}
}

function safeParseV2(raw: string): StoredConsentStateV2 | null {
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (
		typeof value !== 'object' ||
		value === null ||
		(value as { version?: unknown }).version !== 2 ||
		typeof (value as { analytics?: unknown }).analytics !== 'boolean' ||
		typeof (value as { sessionReplay?: unknown }).sessionReplay !== 'boolean'
	) {
		return null
	}
	const v = value as StoredConsentStateV2
	return {
		version: 2,
		analytics: v.analytics,
		sessionReplay: v.sessionReplay,
	}
}
