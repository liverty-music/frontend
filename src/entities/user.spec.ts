import { describe, expect, it } from 'vitest'
import { codeToHome, displayName, translationKey } from './user'

describe('codeToHome', () => {
	it('decomposes Japanese prefecture code', () => {
		expect(codeToHome('JP-13')).toEqual({ countryCode: 'JP', level1: 'JP-13' })
	})

	it('decomposes US state code', () => {
		expect(codeToHome('US-CA')).toEqual({ countryCode: 'US', level1: 'US-CA' })
	})

	it('handles short code without hyphen', () => {
		expect(codeToHome('JP')).toEqual({ countryCode: 'JP', level1: 'JP' })
	})
})

describe('displayName', () => {
	it('returns Japanese name by default', () => {
		expect(displayName('JP-13')).toBe('東京都')
	})

	it('returns English name when specified', () => {
		expect(displayName('JP-13', 'en')).toBe('Tokyo')
	})

	it('returns code as fallback for unknown code', () => {
		expect(displayName('XX-99')).toBe('XX-99')
	})
})

describe('translationKey', () => {
	it('returns key for known prefecture code', () => {
		expect(translationKey('JP-13')).toBe('tokyo')
		expect(translationKey('JP-40')).toBe('fukuoka')
	})

	it('returns code as fallback for unknown code', () => {
		expect(translationKey('XX-99')).toBe('XX-99')
	})
})
