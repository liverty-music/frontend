import { describe, expect, it } from 'vitest'
import { readLoginHintFromSearch } from '../../../organizer/services/login-hint'

describe('readLoginHintFromSearch', () => {
	it('reads the login_hint param', () => {
		expect(readLoginHintFromSearch('?login_hint=user@example.com')).toBe(
			'user@example.com',
		)
	})

	it('trims surrounding whitespace', () => {
		expect(readLoginHintFromSearch('?login_hint=%20user@example.com%20')).toBe(
			'user@example.com',
		)
	})

	it('returns null when the param is absent', () => {
		expect(readLoginHintFromSearch('?org_id=123')).toBeNull()
	})

	it('returns null for an empty query string', () => {
		expect(readLoginHintFromSearch('')).toBeNull()
	})

	it('treats a blank value as absent', () => {
		expect(readLoginHintFromSearch('?login_hint=%20')).toBeNull()
	})
})
