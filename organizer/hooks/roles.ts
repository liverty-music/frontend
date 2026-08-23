/**
 * Reads the `organizer-console` project roles claim from an OIDC token profile
 * and answers whether the operator holds the tenant `owner` role.
 *
 * Zitadel asserts project roles (the OIDC app sets `idTokenRoleAssertion`) into
 * the `urn:zitadel:iam:org:project:roles` claim as an object keyed by role,
 * each value mapping `orgId → domain`:
 *
 *     { "owner": { "<tenantOrgId>": "<tenantDomain>" } }
 *
 * The client guard treats presence of the `owner` key as "admitted". The
 * backend remains the source of truth for authorization (design D2); this is a
 * UX gate only.
 */

/** Zitadel claim carrying the aggregated project roles for the token. */
const PROJECT_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'

/**
 * The single tenant role admitted by the console guard. MUST match the
 * `organizer-console` project role key provisioned in cloud-provisioning
 * (`ORGANIZER_CONSOLE_ROLE_OWNER`).
 */
export const ORGANIZER_OWNER_ROLE = 'owner'

/**
 * Returns true iff `profile` carries the `owner` role in its
 * `organizer-console` project roles claim. Missing/malformed claims are
 * treated as "no owner" (fail closed).
 */
export function hasOwnerRole(
	profile: Record<string, unknown> | undefined | null,
): boolean {
	if (!profile) return false
	const roles = profile[PROJECT_ROLES_CLAIM]
	if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) {
		return false
	}
	return Object.hasOwn(roles as Record<string, unknown>, ORGANIZER_OWNER_ROLE)
}

/**
 * Returns the tenant org ids for which the token carries the `owner` role — the
 * keys of the `owner` map in the project-roles claim. Empty when the claim is
 * missing or malformed.
 */
export function ownerOrgIds(
	profile: Record<string, unknown> | undefined | null,
): string[] {
	if (!profile) return []
	const roles = profile[PROJECT_ROLES_CLAIM]
	if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) {
		return []
	}
	const owner = (roles as Record<string, unknown>)[ORGANIZER_OWNER_ROLE]
	if (owner === null || typeof owner !== 'object' || Array.isArray(owner)) {
		return []
	}
	return Object.keys(owner as Record<string, unknown>)
}

/**
 * Returns true iff the token grants the `owner` role in the given tenant org.
 * The callback uses this to enforce that the authenticated session is the
 * INTENDED tenant (design D-D): a reused SSO session for a different org fails
 * this check, so the operator is not silently onboarded into the wrong org.
 */
export function tokenGrantsOwnerInOrg(
	profile: Record<string, unknown> | undefined | null,
	orgId: string,
): boolean {
	return ownerOrgIds(profile).includes(orgId)
}
