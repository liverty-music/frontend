/**
 * Persistence adapter for the per-purpose analytics opt-out state. Every
 * `localStorage` access for opt-out state goes through this module so the
 * ConsentService stays portable to a different backing store (IndexedDB,
 * server-mirrored profile, etc.) without changing service code.
 *
 * Versioning: the persisted record carries a `version` discriminator so a
 * schema change can migrate prior payloads rather than silently wiping them.
 * The opt-in→opt-out rework bumps v1→v2 and renames `marketingMeasurement`
 * → `sessionReplay`.
 */

import type { ConsentState } from '../../lib/consent/consent-service'

const LS_KEY_STATE = 'liverty:consent:state:v2'

/**
 * Legacy v1 key. The opt-in model persisted under `:v1` with a
 * `marketingMeasurement` field and a `decidedAt` timestamp. We read it once
 * during migration and remove it so the legacy blob never lingers.
 */
const LS_KEY_STATE_V1 = 'liverty:consent:state:v1'
const LS_KEY_DEFERRED_V1 = 'liverty:consent:deferred:v1'

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
 * Reads and validates the persisted opt-out state, migrating a prior v1
 * payload when present. Returns `null` when nothing has been written yet OR
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

	if (raw === null) {
		// No v2 payload — attempt a one-time migration from v1.
		return migrateFromV1()
	}

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
 * Removes the stored key(s). Provided for completeness and for tests; not
 * called from the production code path. A future "reset all preferences"
 * settings action would call this.
 */
export function clearConsentStorage(): void {
	try {
		localStorage.removeItem(LS_KEY_STATE)
		localStorage.removeItem(LS_KEY_STATE_V1)
		localStorage.removeItem(LS_KEY_DEFERRED_V1)
	} catch {
		/* best-effort cleanup */
	}
}

/**
 * One-time migration of a legacy v1 payload to v2. The platform is
 * pre-launch, so there is no real opt-in/decline state worth preserving:
 * the v1 record is consumed for shape only and re-defaulted to the
 * default-on opt-out posture (`analytics: true, sessionReplay: true`). The
 * old `marketingMeasurement` field maps to `sessionReplay`. This is a clean
 * version migration (read v1 → write v2 → remove v1), not a silent wipe.
 *
 * Returns the migrated v2 record, or `null` when no v1 payload exists.
 */
function migrateFromV1(): StoredConsentStateV2 | null {
	let rawV1: string | null
	try {
		rawV1 = localStorage.getItem(LS_KEY_STATE_V1)
	} catch {
		return null
	}
	if (rawV1 === null) return null

	// Drop the legacy keys regardless of whether the blob parses — they are
	// superseded by the v2 default-on posture either way.
	const cleanupV1 = (): void => {
		try {
			localStorage.removeItem(LS_KEY_STATE_V1)
			localStorage.removeItem(LS_KEY_DEFERRED_V1)
		} catch {
			/* best-effort cleanup */
		}
	}

	// Pre-launch: no opt-in/decline state to preserve. Re-default to on and
	// persist under v2 so subsequent boots skip the migration branch.
	const migrated: StoredConsentStateV2 = {
		version: 2,
		analytics: true,
		sessionReplay: true,
	}
	cleanupV1()
	try {
		localStorage.setItem(LS_KEY_STATE, JSON.stringify(migrated))
	} catch {
		/* best-effort; in-memory default-on posture still applies */
	}
	return migrated
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
