import { describe, expect, it } from 'vitest'
import { resolveVenueName } from './concert-mapper'

describe('resolveVenueName', () => {
	describe('lang=ja', () => {
		it('prefers listed_venue_name when both fields are present', () => {
			expect(resolveVenueName('Nippon Budokan', '日本武道館', 'ja')).toBe(
				'日本武道館',
			)
		})

		it('falls back to venue.name when listed_venue_name is absent', () => {
			expect(resolveVenueName('Nippon Budokan', undefined, 'ja')).toBe(
				'Nippon Budokan',
			)
		})

		it('falls back to venue.name when listed_venue_name is empty string', () => {
			expect(resolveVenueName('Nippon Budokan', '', 'ja')).toBe(
				'Nippon Budokan',
			)
		})

		it('returns empty string when both fields are absent', () => {
			expect(resolveVenueName(undefined, undefined, 'ja')).toBe('')
		})
	})

	describe('lang=en', () => {
		it('prefers venue.name when both fields are present', () => {
			expect(resolveVenueName('Nippon Budokan', '日本武道館', 'en')).toBe(
				'Nippon Budokan',
			)
		})

		it('falls back to listed_venue_name when venue.name is absent', () => {
			expect(resolveVenueName(undefined, '日本武道館', 'en')).toBe('日本武道館')
		})

		it('falls back to listed_venue_name when venue.name is empty string', () => {
			expect(resolveVenueName('', '日本武道館', 'en')).toBe('日本武道館')
		})

		it('returns empty string when both fields are absent', () => {
			expect(resolveVenueName(undefined, undefined, 'en')).toBe('')
		})
	})

	describe('default lang (en)', () => {
		it('uses en-priority when no lang is specified', () => {
			expect(resolveVenueName('Venue A', '会場A')).toBe('Venue A')
		})
	})
})
