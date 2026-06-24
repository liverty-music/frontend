import type { ILogger } from 'aurelia'

/**
 * Structural exclusion of APPI 要配慮個人情報 (sensitive personal
 * information) from every analytics payload, enforced in code rather than by
 * consent. An opt-out model cannot lawfully cover sensitive categories
 * (race, creed, social status, medical history, criminal record, history of
 * being a crime victim, physical/mental disability, and the other statutory
 * categories) — these always require explicit opt-in and can never be
 * acquired via opt-out — so they are stripped before any payload reaches
 * PostHog.
 *
 * As data minimisation, precise birth date and age are also stripped, and
 * any age-derived property is bucketized into a coarse range.
 *
 * NOTE: this prevents the system from *knowing* a user is a minor; it does
 * NOT *exclude* minors from default-on capture. Whether default-on (opt-out)
 * capture of the minor segment is acceptable under the APPI EU-adequacy
 * posture is a legal determination deferred to legal counsel — this filter
 * satisfies only the sensitive-category exclusion rule.
 */

/**
 * Denylist of property keys that carry, or strongly correlate with, a
 * sensitive category or a precise birth date / age. Matched case-insensitively
 * as a substring so prefixed/suffixed variants (`user_race`, `medical_notes`)
 * are caught. Keys whose value should be bucketized rather than dropped (age)
 * are handled separately below.
 */
const SENSITIVE_KEY_SUBSTRINGS: readonly string[] = [
	// 要配慮 statutory categories
	'race',
	'ethnic',
	'creed',
	'religion',
	'belief',
	'social_status',
	'medical',
	'health',
	'diagnosis',
	'disease',
	'disability',
	'criminal',
	'offense',
	'conviction',
	'crime_victim',
	'sexuality',
	'sexual_orientation',
	'gender_identity',
	'union',
	'political',
	// precise birth date (age handled by bucketization, not drop)
	'birth_date',
	'birthdate',
	'birthday',
	'date_of_birth',
	'dob',
]

/**
 * Property keys that hold a precise age. These are bucketized into a coarse
 * range rather than dropped, so age-correlated funnels stay possible without
 * transmitting a precise value.
 */
const AGE_KEY_SUBSTRINGS: readonly string[] = ['age']

/** Branded result so callers cannot accidentally bypass the filter. */
export type SanitizedProps = Readonly<Record<string, unknown>>

function matchesAny(key: string, substrings: readonly string[]): boolean {
	const lower = key.toLowerCase()
	return substrings.some((s) => lower.includes(s))
}

/**
 * Bucketize a precise age into a coarse range. Returns `null` for values that
 * are not a finite non-negative number (the key is then dropped entirely).
 */
function bucketizeAge(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return null
	}
	if (value < 18) return 'under_18'
	if (value < 25) return '18_24'
	if (value < 35) return '25_34'
	if (value < 45) return '35_44'
	if (value < 55) return '45_54'
	if (value < 65) return '55_64'
	return '65_plus'
}

/**
 * Strips/bucketizes sensitive properties from an event payload before it
 * reaches PostHog. Returns a new object; the input is never mutated. Each
 * rejection is logged for debugging.
 *
 * @param eventName  the event being emitted (for log context)
 * @param props      the raw property bag
 * @param logger     scoped logger used to surface rejections
 */
export function sanitizeEventProps(
	eventName: string,
	props: Readonly<Record<string, unknown>>,
	logger: ILogger,
): SanitizedProps {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(props)) {
		if (matchesAny(key, AGE_KEY_SUBSTRINGS)) {
			const bucket = bucketizeAge(value)
			if (bucket === null) {
				logger.warn('Dropped non-bucketizable age property from analytics', {
					event: eventName,
					key,
				})
				continue
			}
			out[`${key}_bucket`] = bucket
			logger.debug('Bucketized age property before analytics emission', {
				event: eventName,
				key,
			})
			continue
		}
		if (matchesAny(key, SENSITIVE_KEY_SUBSTRINGS)) {
			logger.warn('Stripped sensitive property before analytics emission', {
				event: eventName,
				key,
			})
			continue
		}
		out[key] = value
	}
	return out
}
