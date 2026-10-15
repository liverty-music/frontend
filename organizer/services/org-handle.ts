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
 * address, then the pin remembered on the device. A pin from the address is
 * remembered for later visits and replaces any other remembered pin. With
 * none, the console shows the find-organizer screen instead of signing in.
 *
 * The short-name form is isolated in {@link primaryDomainOf} and
 * {@link applyOrgPin}: if the primary-domain scope does not pin the
 * Organization (OpenSpec change reuse-fan-email-for-organizer-sign-in, task
 * 0.3), the fallback resolves the short name to an Organization id instead and
 * only these two functions change.
 */
import type { AppConfig } from '../../shared/config/app-config'
import { isOrganizerShortName } from '../../shared/utils/organizer-short-name'

/** localStorage key under which a remembered Organization id is kept. */
export const ORG_ID_STORAGE_KEY = 'organizer.orgId'

/** localStorage key under which a remembered Organizer short name is kept. */
export const ORG_SHORT_NAME_STORAGE_KEY = 'liverty:organizer:org'

/** The Organization a sign-in names: by id, or by the Organizer's short name. */
export type OrgPin =
	| { readonly kind: 'id'; readonly orgId: string }
	| { readonly kind: 'shortName'; readonly shortName: string }

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

function remember(storage: OrgHandleStorage, pin: OrgPin): void {
	try {
		if (pin.kind === 'id') {
			storage.setItem(ORG_ID_STORAGE_KEY, pin.orgId)
			storage.removeItem(ORG_SHORT_NAME_STORAGE_KEY)
		} else {
			storage.setItem(ORG_SHORT_NAME_STORAGE_KEY, pin.shortName)
			storage.removeItem(ORG_ID_STORAGE_KEY)
		}
	} catch {
		// Persisting is best-effort; an unavailable store must not abort entry.
	}
}

function recall(storage: OrgHandleStorage): OrgPin | null {
	try {
		const orgId = storage.getItem(ORG_ID_STORAGE_KEY)?.trim()
		if (orgId) return { kind: 'id', orgId }
		const shortName = storage.getItem(ORG_SHORT_NAME_STORAGE_KEY)?.trim()
		if (shortName && isOrganizerShortName(shortName)) {
			return { kind: 'shortName', shortName }
		}
	} catch {
		// A blocked store (SecurityError) reads as "nothing remembered".
	}
	return null
}

/**
 * Resolves the Organization to name for this session from the entry URL query
 * string and a persistent store. A pin in the address wins and is remembered;
 * otherwise the remembered pin is used. Returns `null` when there is neither.
 */
export function resolveOrgPin(
	search: string,
	storage: OrgHandleStorage,
): OrgPin | null {
	const fromUrl = readOrgPinFromSearch(search)
	if (fromUrl) {
		remember(storage, fromUrl)
		return fromUrl
	}
	return recall(storage)
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
