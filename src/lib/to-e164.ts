/** Separators a fan may type between digit groups. */
const SEPARATORS = /[\s()-]/g

/** Japanese domestic number: a leading 0 followed by 9-10 digits. */
const DOMESTIC = /^0\d{9,10}$/

/** E.164, as enforced by the `PhoneNumber` proto rule. */
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

/** A Japanese mobile or IP number after +81: 50, 70, 80 or 90, then 8 digits. */
const JP_MOBILE = /^\+81([5789]0)(\d{4})(\d{4})$/

/** A Japanese number after +81 other than a mobile one: 9 digits. */
const JP_OTHER = /^\+81(\d{9})$/

/**
 * Shows an E.164 phone number the way a fan in Japan writes it: a Japanese
 * mobile number as `090-1234-5678`, another Japanese number as its domestic
 * digits (`0312345678`), and any other number unchanged. {@link toE164}
 * reads every result back to the same E.164 number.
 */
export function toDomesticDisplay(e164: string): string {
	const mobile = JP_MOBILE.exec(e164)
	if (mobile) return `0${mobile[1]}-${mobile[2]}-${mobile[3]}`
	const other = JP_OTHER.exec(e164)
	if (other) return `0${other[1]}`
	return e164
}
