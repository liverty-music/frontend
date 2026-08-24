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
 * Returns every tenant org id the token carries ANY project-role grant in — the
 * union of the org-id keys across all roles in the project-roles claim. Used as
 * the org membership signal (independent of which role), so the guard can tell a
 * "different-org session" apart from a "no-grants" session. Empty when the claim
 * is missing or malformed.
 */
export function tokenOrgIds(
	profile: Record<string, unknown> | undefined | null,
): string[] {
	if (!profile) return []
	const roles = profile[PROJECT_ROLES_CLAIM]
	if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) {
		return []
	}
	const ids = new Set<string>()
	for (const grant of Object.values(roles as Record<string, unknown>)) {
		if (grant !== null && typeof grant === 'object' && !Array.isArray(grant)) {
			for (const orgId of Object.keys(grant as Record<string, unknown>)) {
				ids.add(orgId)
			}
		}
	}
	return [...ids]
}
