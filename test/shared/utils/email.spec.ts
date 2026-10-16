import { describe, expect, it } from 'vitest'
import { EMAIL_MAX_LENGTH, emailProblem } from '../../../shared/utils/email'
import { isOrganizerShortName } from '../../../shared/utils/organizer-short-name'

describe('emailProblem', () => {
	it('accepts an email address', () => {
		expect(emailProblem('owner@xx-records.example')).toBeNull()
	})

	it('reports an empty value', () => {
		expect(emailProblem('')).toBe('empty')
	})

	it.each(['band@', 'band', '@example.com', 'a b@example.com'])(
		'reports %s as invalid',
		(value) => {
			expect(emailProblem(value)).toBe('invalid')
		},
	)

	it('accepts 165 characters and refuses 166', () => {
		const at165 = `${'a'.repeat(EMAIL_MAX_LENGTH - 12)}@example.com`
		expect(at165).toHaveLength(165)
		expect(emailProblem(at165)).toBeNull()
		expect(emailProblem(`a${at165}`)).toBe('tooLong')
	})
})

describe('isOrganizerShortName', () => {
	it.each(['xx-records', 'band2026', 'e2e-test', 'abc', 'a'.repeat(32)])(
		'accepts %s',
		(value) => {
			expect(isOrganizerShortName(value)).toBe(true)
		},
	)

	it.each([
		'XX Records',
		'2band',
		'ab',
		'admin',
		'liverty-music',
		'a'.repeat(33),
	])('refuses %s', (value) => {
		expect(isOrganizerShortName(value)).toBe(false)
	})
})
