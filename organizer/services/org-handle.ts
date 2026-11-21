/**
 * Org-pinned entry for the organizer console (design D4). The console
 * authenticates every Organizer through one shared OIDC client; each sign-in
 * names the Organizer's Organization at the identity provider, never an email
 * domain, and never none: a sign-in naming no Organization resolves to the
 * person's fan account when the fan and Organizer emails are the same.
 *
 * The address or the device names the Organization in one of two forms:
 *
 *   - `?org_id=<Organization id>` - what the invitation's return address
 *     (the Organization login policy's `defaultRedirectUri`) carries. Pinned with
 *     the scope `urn:zitadel:iam:org:id:<id>`.
 *   - `?org=<short name>` - what the emailed sign-in links and hand-typed
 *     addresses carry. Pinned with the scope
 *     `urn:zitadel:iam:org:domain:primary:<short name>.<identity provider host>`,
 *     the Organization's generated primary domain (the Organization is named by
 *     the short name).
 *
 * Resolution order (first hit wins): `org_id` in the address, `org` in the
 * address, then the pin remembered on the device. With none, the console shows
 * the find-organizer screen instead of signing in.
 *
 * A pin from the address is remembered for later visits only after a sign-in
 * to its Organization admits the member ({@link rememberOrgPin}, called by the
 * route guard), and only then replaces any other remembered pin. Until then it
 * is kept as the pending pin of this sign-in, which only the OIDC callback page
 * reads: a link naming an Organizer that does not exist, or no longer does,
 * therefore never sticks to the device, and the next visit without a link uses
 * the remembered pin or shows find-organizer.
 *
 * The short-name form is isolated in {@link primaryDomainOf} and
 * {@link applyOrgPin}: if the primary-domain scope does not pin the
 * Organization (OpenSpec change reuse-fan-email-for-organizer-sign-in, task
 * 0.3), the fallback resolves the short name to an Organization id instead and
 * only these two functions change.
 */
import { DI } from 'aurelia'
import type { AppConfig } from '../../shared/config/app-config'
import { isOrganizerShortName } from '../../shared/utils/organizer-short-name'

/** localStorage key under which a remembered Organization id is kept. */
export const ORG_ID_STORAGE_KEY = 'organizer.orgId'

/** localStorage key under which a remembered Organizer short name is kept. */
export const ORG_SHORT_NAME_STORAGE_KEY = 'organizer.orgShortName'

/**
 * localStorage key under which the pin of a sign-in in progress is kept: the
 * pin an address named, until the sign-in it started returns to the OIDC
 * callback. localStorage, not sessionStorage, so a callback that lands in
 * another tab of the same browser still names the same Organization.
 */
export const PENDING_ORG_PIN_STORAGE_KEY = 'organizer.pendingOrgPin'

/** The address the identity provider returns to after a sign-in. */
const CALLBACK_PATH = '/auth/callback'

/** The Organization a sign-in names: by id, or by the Organizer's short name. */
export type OrgPin =
	| { readonly kind: 'id'; readonly orgId: string }
	| { readonly kind: 'shortName'; readonly shortName: string }

/**
 * DI token for the pin this page load resolved (`null` when it has none). The
 * route guard reads it to remember the pin once a sign-in to it admits the
 * member.
 */
export const IOrgPin = DI.createInterface<OrgPin | null>('IOrgPin', (x) =>
	x.instance(null),
)

/**
 * Reads the pin from a URL query string (e.g. `window.location.search`).
 * `org_id` wins over `org`; an `org` that is not a valid short name (such as an
 * Organization id from a link made before short names existed) is ignored.
 * Returns `null` when the address names no Organization.
 */
export function readOrgPinFromSearch(search: string): OrgPin | null {
	const params = new URLSearchParams(search)
	const orgId = params.get('org_id')?.trim()
	if (orgId) return { kind: 'id', orgId }
	const shortName = params.get('org')?.trim()
	if (shortName && isOrganizerShortName(shortName)) {
		return { kind: 'shortName', shortName }
	}
	return null
}

/** Minimal storage surface this module touches. Lets tests pass a plain stub. */
export type OrgHandleStorage = Pick<
	Storage,
	'getItem' | 'setItem' | 'removeItem'
>

function readPin(
	storage: OrgHandleStorage,
	idKey: string,
	shortNameKey: string,
): OrgPin | null {
	const orgId = storage.getItem(idKey)?.trim()
	if (orgId) return { kind: 'id', orgId }
	const shortName = storage.getItem(shortNameKey)?.trim()
	if (shortName && isOrganizerShortName(shortName)) {
		return { kind: 'shortName', shortName }
	}
	return null
}

function recall(storage: OrgHandleStorage): OrgPin | null {
	try {
		return readPin(storage, ORG_ID_STORAGE_KEY, ORG_SHORT_NAME_STORAGE_KEY)
	} catch {
		// A blocked store (SecurityError) reads as "nothing remembered".
		return null
	}
}

function recallPending(storage: OrgHandleStorage): OrgPin | null {
	try {
		const raw = storage.getItem(PENDING_ORG_PIN_STORAGE_KEY)
		if (!raw) return null
		const { orgId, shortName } = JSON.parse(raw) as {
			orgId?: unknown
			shortName?: unknown
		}
		if (typeof orgId === 'string' && orgId.trim()) {
			return { kind: 'id', orgId: orgId.trim() }
		}
		if (typeof shortName === 'string' && isOrganizerShortName(shortName)) {
			return { kind: 'shortName', shortName }
		}
	} catch {
		// A blocked store or a malformed entry reads as "no sign-in pending".
	}
	return null
}

function savePending(storage: OrgHandleStorage, pin: OrgPin): void {
	try {
		storage.setItem(
			PENDING_ORG_PIN_STORAGE_KEY,
			JSON.stringify(
				pin.kind === 'id' ? { orgId: pin.orgId } : { shortName: pin.shortName },
			),
		)
	} catch {
		// Best-effort: without it the callback falls back to the remembered pin.
	}
}

function clearPending(storage: OrgHandleStorage): void {
	try {
		storage.removeItem(PENDING_ORG_PIN_STORAGE_KEY)
	} catch {
		// best-effort
	}
}

function samePin(a: OrgPin | null, b: OrgPin): boolean {
	if (!a) return false
	if (a.kind === 'id') return b.kind === 'id' && a.orgId === b.orgId
	return b.kind === 'shortName' && a.shortName === b.shortName
}

/**
 * Resolves the Organization to name for this page load from the entry URL's
 * query string, a persistent store and the entry URL's path (`search` and
 * `pathname` of `window.location`). Returns `null` when nothing names one.
 *
 *   - A pin in the address wins. It is kept as the pending pin of the sign-in
 *     it starts, not remembered.
 *   - On the OIDC callback page, the pending pin names the Organization the
 *     sign-in was started for; without one, the remembered pin does.
 *   - Anywhere else the remembered pin is used, and a pending pin left by a
 *     sign-in that never came back is dropped.
 */
export function resolveOrgPin(
	search: string,
	storage: OrgHandleStorage,
	pathname: string,
): OrgPin | null {
	const fromUrl = readOrgPinFromSearch(search)
	if (fromUrl) {
		savePending(storage, fromUrl)
		return fromUrl
	}
	if (pathname === CALLBACK_PATH) {
		return recallPending(storage) ?? recall(storage)
	}
	clearPending(storage)
	return recall(storage)
}

/**
 * Remembers `pin` on the device for later visits, replacing any other
 * remembered pin, and ends the pending sign-in. The route guard calls it once a
 * sign-in to the pinned Organization admits the member, so only an Organization
 * someone signed in to is ever remembered. Writes nothing when `pin` is
 * already the remembered one and no sign-in is pending.
 */
export function rememberOrgPin(storage: OrgHandleStorage, pin: OrgPin): void {
	try {
		if (
			samePin(recall(storage), pin) &&
			storage.getItem(PENDING_ORG_PIN_STORAGE_KEY) === null
		) {
			return
		}
		if (pin.kind === 'id') {
			storage.setItem(ORG_ID_STORAGE_KEY, pin.orgId)
			storage.removeItem(ORG_SHORT_NAME_STORAGE_KEY)
		} else {
			storage.setItem(ORG_SHORT_NAME_STORAGE_KEY, pin.shortName)
			storage.removeItem(ORG_ID_STORAGE_KEY)
		}
		storage.removeItem(PENDING_ORG_PIN_STORAGE_KEY)
	} catch {
		// Persisting is best-effort; an unavailable store must not abort entry.
	}
}

/**
 * The generated primary domain of the Organization named by `shortName`:
 * `<short name>.<identity provider host>`, the host taken from the configured
 * issuer (`https://auth.liverty-music.app` → `xx-records.auth.liverty-music.app`).
 */
export function primaryDomainOf(shortName: string, issuer: string): string {
	return `${shortName}.${new URL(issuer).hostname}`
}

/**
 * Folds the pin into the config the shared AuthService reads: an id becomes
 * `zitadelOrgId`, a short name becomes `zitadelOrgPrimaryDomain`. Without a pin
 * the config is returned unchanged (no Organization; the console shows
 * find-organizer instead of signing in).
 */
export function applyOrgPin(config: AppConfig, pin: OrgPin | null): AppConfig {
	if (!pin) return config
	if (pin.kind === 'id') return { ...config, zitadelOrgId: pin.orgId }
	return {
		...config,
		zitadelOrgPrimaryDomain: primaryDomainOf(
			pin.shortName,
			config.zitadelIssuer,
		),
	}
}
