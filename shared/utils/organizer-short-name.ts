/**
 * Client-side check of an Organizer short name against the generated
 * `liverty_music.entity.v1.OrganizerShortName` rule: a lowercase letter, then
 * 2 to 31 lowercase letters, digits or hyphens, and not one of the reserved
 * names of the product and admin organizations. The server repeats the check.
 */

const SHORT_NAME_PATTERN = /^[a-z][a-z0-9-]{2,31}$/

/** Short names the identity provider's own organizations already use. */
export const RESERVED_ORGANIZER_SHORT_NAMES: ReadonlySet<string> = new Set([
	'admin',
	'liverty-music',
])

/** True when `value` is a valid, unreserved Organizer short name. */
export function isOrganizerShortName(value: string): boolean {
	return (
		SHORT_NAME_PATTERN.test(value) && !RESERVED_ORGANIZER_SHORT_NAMES.has(value)
	)
}
