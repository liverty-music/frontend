/**
 * Org-pinned entry resolution for the organizer console (design D1). The
 * console authenticates every Organizer tenant through one shared OIDC client;
 * the tenant org is pinned per session by an **org handle**, NOT by email
 * domain. This module resolves that handle into the Zitadel org id, which the
 * shared AuthService turns into the `urn:zitadel:iam:org:id:<id>` scope so
 * Zitadel applies the tenant org's passkey-primary login policy.
 *
 * Resolution order (first hit wins):
 *   1. an `org_id` (alias `org`) query parameter on the entry URL — the id
 *      carried by the org-scoped passkey init link on first sign-in, or a
 *      re-issued sign-in link;
 *   2. a previously remembered id in localStorage — so a returning operator on
 *      the same device re-enters their own tenant without the handle in the URL.
 *
 * When a handle arrives on the URL it is persisted (remembered) for later
 * visits. A fresh device with neither a handle nor a remembered id resolves to
 * `null`: sign-in proceeds unpinned and the org-code / "email me a sign-in
 * link" entry is the recovery path (an app-level business flow, later change).
 */

/** localStorage key under which a resolved org handle is remembered. */
export const ORG_ID_STORAGE_KEY = 'liverty:organizer:org_id'

/**
 * Query parameter names carrying the org handle, in priority order. `org_id`
 * is canonical (what the passkey init / re-issued sign-in link emits); `org`
 * is a shorter alias for hand-typed entry.
 */
const PARAM_KEYS = ['org_id', 'org'] as const

/**
 * Reads the org handle from a URL query string (e.g. `window.location.search`).
 * Returns the first non-empty `org_id`/`org` value, or `null` when absent.
 */
export function readOrgHandleFromSearch(search: string): string | null {
	const params = new URLSearchParams(search)
	for (const key of PARAM_KEYS) {
		const value = params.get(key)?.trim()
		if (value) return value
	}
	return null
}

/** Minimal storage surface — the two methods this module touches. Lets tests
 *  pass a plain stub without a full `Storage` implementation. */
export type OrgHandleStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Resolves the org id to pin for this session from the entry URL query string
 * and a persistent store. A URL handle wins and is remembered; otherwise the
 * remembered id is used. Returns `null` when neither is present.
 *
 * Storage access is wrapped defensively: a `SecurityError` (e.g. storage
 * disabled) degrades to "no remembered id" rather than breaking bootstrap.
 */
export function resolveOrgId(
	search: string,
	storage: OrgHandleStorage,
): string | null {
	const fromUrl = readOrgHandleFromSearch(search)
	if (fromUrl) {
		try {
			storage.setItem(ORG_ID_STORAGE_KEY, fromUrl)
		} catch {
			// Persisting is best-effort; an unavailable store must not abort entry.
		}
		return fromUrl
	}
	let remembered: string | null = null
	try {
		remembered = storage.getItem(ORG_ID_STORAGE_KEY)
	} catch {
		remembered = null
	}
	return remembered?.trim() || null
}
