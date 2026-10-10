/** Separators a fan may type between digit groups. */
const SEPARATORS = /[\s()-]/g

/** Japanese domestic number: a leading 0 followed by 9-10 digits. */
const DOMESTIC = /^0\d{9,10}$/

/** E.164, as enforced by the `ApplicantIdentity.phone_number` proto rule. */
const E164 = /^\+[1-9]\d{1,14}$/

/**
 * Normalizes a phone number typed by the fan to E.164, the only format the
 * backend accepts. A Japanese domestic number (`090-1234-5678`) becomes
 * `+81` followed by the digits without the leading 0; an E.164 number has
 * its separators removed. Returns `null` when the input fits neither form.
 */
export function toE164(input: string): string | null {
	const compact = input.replace(SEPARATORS, '')
	if (DOMESTIC.test(compact)) return `+81${compact.slice(1)}`
	if (E164.test(compact)) return compact
	return null
}
