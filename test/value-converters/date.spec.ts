import { I18N } from '@aurelia/i18n'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateValueConverter } from '../../src/value-converters/date'
import { createTestContainer } from '../helpers/create-container'

describe('DateValueConverter', () => {
	let converter: DateValueConverter

	beforeEach(() => {
		// I18N mock returns 'ja' by default from createTestContainer
		const container = createTestContainer(
			Registration.instance(I18N, {
				tr: vi.fn(),
				getLocale: vi.fn(() => 'ja'),
				setLocale: vi.fn(),
			}),
		)
		container.register(DateValueConverter)
		converter = container.get(DateValueConverter)
	})

	describe('toView - short format', () => {
		it('should format a Date to short ja-JP format', () => {
			const date = new Date(2026, 1, 25) // Feb 25, 2026
			const result = converter.toView(date, 'short')
			expect(result).toBe('2/25')
		})

		it('should default to short format when no format specified', () => {
			const date = new Date(2026, 11, 1) // Dec 1, 2026
			const result = converter.toView(date)
			expect(result).toBe('12/1')
		})

		it('should parse a date string', () => {
			const result = converter.toView('2026-03-15', 'short')
			expect(result).toMatch(/3\/15/)
		})
	})

	describe('toView - long format', () => {
		it('should format a Date to long ja-JP format with weekday', () => {
			const date = new Date(2026, 1, 25) // Feb 25, 2026 (Wednesday)
			const result = converter.toView(date, 'long')
			expect(result).toMatch(/2026年2月25日/)
			expect(result).toMatch(/水/)
		})

		it('should format a date string to long format', () => {
			const result = converter.toView('2026-07-04', 'long')
			expect(result).toMatch(/2026年7月/)
		})
	})

	describe('toView - relative format', () => {
		beforeEach(() => {
			vi.useFakeTimers()
			vi.setSystemTime(new Date(2026, 1, 25, 12, 0, 0))
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it('should return relative future days', () => {
			const futureDate = new Date(2026, 1, 28, 12, 0, 0) // 3 days later
			const result = converter.toView(futureDate, 'relative')
			expect(result).toMatch(/3\s*日後/)
		})

		it('should return relative past days', () => {
			const pastDate = new Date(2026, 1, 22, 12, 0, 0) // 3 days ago
			const result = converter.toView(pastDate, 'relative')
			expect(result).toMatch(/3\s*日前/)
		})

		it('should return relative hours when less than a day', () => {
			const futureDate = new Date(2026, 1, 25, 15, 0, 0) // 3 hours later
			const result = converter.toView(futureDate, 'relative')
			expect(result).toMatch(/3\s*時間後/)
		})

		it('should return relative minutes when less than an hour', () => {
			const futureDate = new Date(2026, 1, 25, 12, 30, 0) // 30 minutes later
			const result = converter.toView(futureDate, 'relative')
			expect(result).toMatch(/30\s*分後/)
		})
	})

	describe('edge cases', () => {
		it('should return empty string for null', () => {
			expect(converter.toView(null)).toBe('')
		})

		it('should return empty string for undefined', () => {
			expect(converter.toView(undefined)).toBe('')
		})

		it('should return empty string for empty string', () => {
			expect(converter.toView('')).toBe('')
		})

		it('should return empty string for invalid date string', () => {
			expect(converter.toView('not-a-date')).toBe('')
		})

		it('should handle ISO date strings', () => {
			const result = converter.toView('2026-02-25T10:00:00Z', 'long')
			expect(result).toMatch(/2026年2月25日/)
		})
	})
})
