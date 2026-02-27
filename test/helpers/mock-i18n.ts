import { vi } from 'vitest'

/**
 * Creates a mock I18N service for testing.
 * By default, `tr()` returns the key with interpolation placeholders replaced.
 * `getLocale()` returns 'ja' and `setLocale()` is a no-op.
 */
export function createMockI18n() {
	let currentLocale = 'ja'

	return {
		tr: vi.fn((key: string, opts?: Record<string, unknown>) => {
			if (!opts) return key
			let result = key
			for (const [k, v] of Object.entries(opts)) {
				result += ` ${k}=${v}`
			}
			return result
		}),
		getLocale: vi.fn(() => currentLocale),
		setLocale: vi.fn(async (locale: string) => {
			currentLocale = locale
		}),
		nf: vi.fn((value: number) => String(value)),
		df: vi.fn((value: Date) => value.toISOString()),
		rt: vi.fn((value: Date) => value.toISOString()),
	}
}
