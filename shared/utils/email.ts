/**
 * Client-side check of an email address against the generated
 * `liverty_music.entity.v1.Email` rule (protovalidate `string.email`, at most
 * 165 characters), so a screen reports the problem next to its field before
 * any request is sent. The server repeats the check.
 */

/** Maximum length of any email, in characters (`Email.value` `max_len`). */
export const EMAIL_MAX_LENGTH = 165

/**
 * The WHATWG HTML "valid email address" grammar, which protovalidate's
 * `string.email` rule follows.
 */
const EMAIL_PATTERN =
	/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** What is wrong with an email value, or null when it is a valid email. */
export type EmailProblem = 'empty' | 'invalid' | 'tooLong'

/**
 * Checks a trimmed email value. Length is counted in code points, the unit
 * protovalidate's `max_len` uses.
 */
export function emailProblem(value: string): EmailProblem | null {
	if (value.length === 0) return 'empty'
	if ([...value].length > EMAIL_MAX_LENGTH) return 'tooLong'
	if (!EMAIL_PATTERN.test(value)) return 'invalid'
	return null
}
