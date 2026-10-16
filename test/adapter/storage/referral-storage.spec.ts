import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	loadReferral,
	normalizeReferralCode,
	REFERRAL_TTL_MS,
	referralCodeForSeries,
	saveReferral,
} from '../../../src/adapter/storage/referral-storage'

const NOW = Date.UTC(2026, 10, 1, 3, 0, 0) // 1 November 12:00 JST

beforeEach(() => {
	localStorage.clear()
})

afterEach(() => {
	localStorage.clear()
	vi.restoreAllMocks()
})

describe('referral-storage', () => {
	describe('save and load', () => {
		it('keeps the code with its Series and a 7-day expiry under the key "referral"', () => {
			saveReferral('member-a', 'series-xx', NOW)

			expect(loadReferral(NOW)).toEqual({
				code: 'member-a',
				seriesId: 'series-xx',
				expiresAt: NOW + REFERRAL_TTL_MS,
			})
			expect(JSON.parse(localStorage.getItem('referral') ?? 'null')).toEqual({
				code: 'member-a',
				seriesId: 'series-xx',
				expiresAt: NOW + REFERRAL_TTL_MS,
			})
		})

		it('a later save replaces the kept code (last link wins)', () => {
			saveReferral('member-a', 'series-xx', NOW)
			saveReferral('member-b', 'series-yy', NOW + 1000)

			expect(loadReferral(NOW + 1000)?.code).toBe('member-b')
			expect(loadReferral(NOW + 1000)?.seriesId).toBe('series-yy')
		})

		it('returns null when nothing is kept', () => {
			expect(loadReferral(NOW)).toBeNull()
		})
	})

	describe('expiry', () => {
		it('still counts one millisecond before 7 days have passed', () => {
			saveReferral('member-a', 'series-xx', NOW)

			expect(loadReferral(NOW + REFERRAL_TTL_MS - 1)?.code).toBe('member-a')
		})

		it('expires at exactly 7 days and removes the entry', () => {
			saveReferral('member-a', 'series-xx', NOW)

			expect(loadReferral(NOW + REFERRAL_TTL_MS)).toBeNull()
			expect(localStorage.getItem('referral')).toBeNull()
		})
	})

	describe('malformed entries', () => {
		it.each([
			['not JSON', '{not json'],
			['not an object', '"member-a"'],
			['null', 'null'],
			[
				'missing seriesId',
				JSON.stringify({ code: 'member-a', expiresAt: NOW + 1 }),
			],
			[
				'invalid code',
				JSON.stringify({ code: 'Member_A', seriesId: 's', expiresAt: NOW + 1 }),
			],
			[
				'non-numeric expiry',
				JSON.stringify({ code: 'member-a', seriesId: 's', expiresAt: 'x' }),
			],
		])('drops an entry that is %s', (_label, raw) => {
			localStorage.setItem('referral', raw)

			expect(loadReferral(NOW)).toBeNull()
			expect(localStorage.getItem('referral')).toBeNull()
		})
	})

	describe('storage that throws', () => {
		it('save does not throw', () => {
			vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
				throw new DOMException('blocked', 'SecurityError')
			})

			expect(() => saveReferral('member-a', 'series-xx', NOW)).not.toThrow()
		})

		it('load returns null', () => {
			vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
				throw new DOMException('blocked', 'SecurityError')
			})

			expect(loadReferral(NOW)).toBeNull()
		})

		it('load of an expired entry does not throw when removal fails', () => {
			saveReferral('member-a', 'series-xx', NOW)
			vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
				throw new DOMException('blocked', 'SecurityError')
			})

			expect(loadReferral(NOW + REFERRAL_TTL_MS)).toBeNull()
		})
	})

	describe('normalizeReferralCode', () => {
		it.each([
			['member-a', 'member-a'],
			['Member-A', 'member-a'],
			['a'.repeat(32), 'a'.repeat(32)],
		])('accepts %s as %s', (raw, expected) => {
			expect(normalizeReferralCode(raw)).toBe(expected)
		})

		it.each([
			[null],
			[''],
			['a'.repeat(33)],
			['member_b'],
			['a b'],
			['メンバーA'],
		])('rejects %s', (raw) => {
			expect(normalizeReferralCode(raw)).toBeNull()
		})
	})

	describe('referralCodeForSeries', () => {
		it('returns the code kept for the same Series', () => {
			saveReferral('member-a', 'series-xx', NOW)

			expect(referralCodeForSeries('series-xx', NOW)).toBe('member-a')
		})

		it('returns undefined for another Series and keeps the entry', () => {
			saveReferral('member-a', 'series-xx', NOW)

			expect(referralCodeForSeries('series-yy', NOW)).toBeUndefined()
			expect(loadReferral(NOW)?.code).toBe('member-a')
		})

		it('returns undefined when the Series is unknown', () => {
			saveReferral('member-a', 'series-xx', NOW)

			expect(referralCodeForSeries(undefined, NOW)).toBeUndefined()
			expect(referralCodeForSeries('', NOW)).toBeUndefined()
		})
	})
})
