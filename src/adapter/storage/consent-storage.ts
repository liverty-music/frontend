/**
 * Persistence adapter for per-purpose analytics consent. Every
 * `localStorage` access for consent state goes through this module so
 * the ConsentService stays portable to a different backing store
 * (IndexedDB, server-mirrored profile, etc.) without changing service
 * code. See CLAUDE.md "Key Technical Decision #3".
 */

import type { ConsentState } from '../../lib/consent/consent-service'

const LS_KEY_STATE = 'liverty:consent:state:v1'
const LS_KEY_DEFERRED = 'liverty:consent:deferred:v1'

/**
 * Persisted v1 shape on `localStorage`. `version` is a forward-compat
 * seam: a future change that needs richer metadata (e.g. per-purpose
 * timestamps) will bump this and add a migration branch in
 * `loadConsentState`.
 */
export type StoredConsentStateV1 = {
	version: 1
	analytics: boolean
	marketingMeasurement: boolean
	decidedAt: string | null
}

/**
 * Reads and validates the persisted consent state. Returns `null` when
 * nothing has been written yet OR when the stored blob is corrupt /
 * schema-mismatched. Corrupt blobs are removed in place so the warning
 * surface does not repeat on every subsequent boot. SecurityErrors
 * (privacy-mode Safari, sandboxed iframes) are caught — the caller
 * sees `null` and continues with defaults.
 */
export function loadConsentState(): StoredConsentStateV1 | null {
	let raw: string | null
	try {
		raw = localStorage.getItem(LS_KEY_STATE)
	} catch {
		return null
	}
	if (raw === null) return null

	const parsed = safeParse(raw)
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
 * Writes the consent state. Throws on `SecurityError` are swallowed so a
 * failed persist never crashes the in-memory flow — the caller's logger
 * surfaces the issue. Returns `true` iff the write succeeded.
 */
export function saveConsentState(
	state: ConsentState,
	decidedAt: string | null,
): boolean {
	const payload: StoredConsentStateV1 = {
		version: 1,
		analytics: state.analytics,
		marketingMeasurement: state.marketingMeasurement,
		decidedAt,
	}
	try {
		localStorage.setItem(LS_KEY_STATE, JSON.stringify(payload))
		return true
	} catch {
		return false
	}
}

/**
 * Reads the "consent decision was deferred" flag. Used by
 * `IConsentService.hasDecided()` to skip re-prompting users who tapped
 * "Set up later" on a prior boot. Failures (privacy-mode, etc.) are
 * treated as "not deferred" so onboarding behaves consistently.
 */
export function loadConsentDeferred(): boolean {
	try {
		return localStorage.getItem(LS_KEY_DEFERRED) === '1'
	} catch {
		return false
	}
}

/**
 * Writes the deferred flag. Returns `true` on success; storage failures
 * are swallowed so the in-memory `deferred` state still drives onboarding
 * progression for the current session.
 */
export function saveConsentDeferred(): boolean {
	try {
		localStorage.setItem(LS_KEY_DEFERRED, '1')
		return true
	} catch {
		return false
	}
}

/**
 * Removes both stored keys. Provided for completeness and for tests; not
 * called from the production code path. A future "reset all preferences"
 * settings action would call this.
 */
export function clearConsentStorage(): void {
	try {
		localStorage.removeItem(LS_KEY_STATE)
		localStorage.removeItem(LS_KEY_DEFERRED)
	} catch {
		/* best-effort cleanup */
	}
}

function safeParse(raw: string): StoredConsentStateV1 | null {
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (
		typeof value !== 'object' ||
		value === null ||
		(value as { version?: unknown }).version !== 1 ||
		typeof (value as { analytics?: unknown }).analytics !== 'boolean' ||
		typeof (value as { marketingMeasurement?: unknown })
			.marketingMeasurement !== 'boolean'
	) {
		return null
	}
	const decidedAt = (value as { decidedAt?: unknown }).decidedAt
	if (decidedAt !== null && typeof decidedAt !== 'string') {
		return null
	}
	const v = value as StoredConsentStateV1
	return {
		version: 1,
		analytics: v.analytics,
		marketingMeasurement: v.marketingMeasurement,
		decidedAt: v.decidedAt,
	}
}
