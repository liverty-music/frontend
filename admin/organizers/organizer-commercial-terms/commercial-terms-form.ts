import type {
	BusinessDetailsInput,
	Organizer,
} from '../../services/organizer-client'

/**
 * Pure form logic for an Organizer's commercial terms: the 特商法 business details
 * and the platform fee rate. The limits mirror the protovalidate rules on
 * the `liverty_music.entity.v1.Organizer` business-detail value messages
 * (`LegalName`, `RepresentativeName`, `BusinessAddress`, `PhoneNumber`,
 * `Email`) and
 * `SetPlatformFeeRateRequest.platform_fee_rate_bps`, so an invalid value is
 * caught next to its field before any request is sent.
 */

/** Upper bound of the platform fee rate in basis points (30%). */
export const MAX_PLATFORM_FEE_RATE_BPS = 3000

/** Maximum character counts of the length-limited business-detail fields. */
export const BUSINESS_DETAILS_MAX_LENGTH = {
	legalName: 200,
	representativeName: 100,
	businessAddress: 300,
} as const

/** E.164, as in the proto: "+", a non-zero digit, then 1 to 14 digits. */
const E164_PATTERN = /^\+[1-9][0-9]{1,14}$/

/**
 * The WHATWG HTML "valid email businessAddress" grammar, which protovalidate's
 * `string.email` rule follows.
 */
const EMAIL_PATTERN =
	/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** A percentage with up to two decimals, e.g. "5", "5.5" or "5.00". */
const PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,2}))?$/

export type BusinessDetailsField = keyof BusinessDetailsInput

/** Per-field error copy; a field without an entry is valid. */
export type BusinessDetailsErrors = Partial<
	Record<BusinessDetailsField, string>
>

export const EMPTY_BUSINESS_DETAILS: BusinessDetailsInput = {
	legalName: '',
	representativeName: '',
	businessAddress: '',
	businessPhoneNumber: '',
	contactEmail: '',
}

/** Copies the Organizer's stored business details into form values; absent ones give empty fields. */
export function toBusinessDetailsInput(
	organizer: Organizer | undefined,
): BusinessDetailsInput {
	return {
		legalName: organizer?.legalName?.value ?? '',
		representativeName: organizer?.representativeName?.value ?? '',
		businessAddress: organizer?.businessAddress?.value ?? '',
		businessPhoneNumber: organizer?.businessPhoneNumber?.value ?? '',
		contactEmail: organizer?.contactEmail?.value ?? '',
	}
}

/** True when the Organizer has all five business details stored. */
export function hasStoredBusinessDetails(organizer: Organizer): boolean {
	return Object.values(toBusinessDetailsInput(organizer)).every(
		(v) => v.trim() !== '',
	)
}

/** Trims every value; surrounding whitespace is never meaningful here. */
export function trimBusinessDetails(
	input: BusinessDetailsInput,
): BusinessDetailsInput {
	return {
		legalName: input.legalName.trim(),
		representativeName: input.representativeName.trim(),
		businessAddress: input.businessAddress.trim(),
		businessPhoneNumber: input.businessPhoneNumber.trim(),
		contactEmail: input.contactEmail.trim(),
	}
}

/** Character count in code points, the unit protovalidate's `max_len` uses. */
function charLength(value: string): number {
	return [...value].length
}

function lengthError(
	value: string,
	max: number,
	label: string,
): string | undefined {
	if (value.length === 0) return `Enter the ${label}.`
	if (charLength(value) > max)
		return `The ${label} must be ${max} characters or fewer.`
	return undefined
}

/**
 * Validates trimmed business details. All five values are required because the
 * server replaces the details as a whole.
 */
export function validateBusinessDetails(
	input: BusinessDetailsInput,
): BusinessDetailsErrors {
	const errors: BusinessDetailsErrors = {}
	const legalName = lengthError(
		input.legalName,
		BUSINESS_DETAILS_MAX_LENGTH.legalName,
		'legal name',
	)
	if (legalName) errors.legalName = legalName
	const representativeName = lengthError(
		input.representativeName,
		BUSINESS_DETAILS_MAX_LENGTH.representativeName,
		'representative name',
	)
	if (representativeName) errors.representativeName = representativeName
	const businessAddress = lengthError(
		input.businessAddress,
		BUSINESS_DETAILS_MAX_LENGTH.businessAddress,
		'business address',
	)
	if (businessAddress) errors.businessAddress = businessAddress

	if (input.businessPhoneNumber.length === 0) {
		errors.businessPhoneNumber = 'Enter the business phone number.'
	} else if (!E164_PATTERN.test(input.businessPhoneNumber)) {
		errors.businessPhoneNumber =
			'Enter the business phone number in international form, e.g. +81312345678 (not 03-1234-5678).'
	}

	if (input.contactEmail.length === 0) {
		errors.contactEmail = 'Enter the contact email.'
	} else if (!EMAIL_PATTERN.test(input.contactEmail)) {
		errors.contactEmail = 'Enter a valid email businessAddress.'
	}
	return errors
}

/**
 * Whether any field has an error. Checks values, not keys: once the errors
 * object is bound, Aurelia's property observers define every bound field on
 * it, so a valid field can be present with an `undefined` value.
 */
export function hasBusinessDetailsErrors(
	errors: BusinessDetailsErrors,
): boolean {
	return Object.values(errors).some((message) => message !== undefined)
}

/** Formats basis points as a percentage with two decimals: 500 → "5.00". */
export function bpsToPercentText(bps: number): string {
	const whole = Math.trunc(bps / 100)
	const fraction = String(bps % 100).padStart(2, '0')
	return `${whole}.${fraction}`
}

export type PercentParseResult =
	| { readonly ok: true; readonly bps: number }
	| { readonly ok: false; readonly error: string }

/**
 * Parses a percentage with up to two decimals into integer basis points
 * ("5.00" → 500). Uses string arithmetic, not floating point, so "0.29"
 * becomes exactly 29. The result is limited to 0% to 30%.
 */
export function parsePercentToBps(text: string): PercentParseResult {
	const value = text.trim()
	if (value.length === 0) return { ok: false, error: 'Enter a rate.' }
	const match = PERCENT_PATTERN.exec(value)
	if (!match) {
		return {
			ok: false,
			error: 'Enter a percentage with up to two decimals, e.g. 5.00.',
		}
	}
	const whole = Number(match[1])
	const fraction = Number((match[2] ?? '').padEnd(2, '0'))
	const bps = whole * 100 + fraction
	if (bps > MAX_PLATFORM_FEE_RATE_BPS) {
		return { ok: false, error: 'The rate must be between 0% and 30%.' }
	}
	return { ok: true, bps }
}
