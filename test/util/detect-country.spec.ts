// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

function mockTimezone(tz: string) {
	vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
		resolvedOptions: () =>
			({ timeZone: tz }) as Intl.ResolvedDateTimeFormatOptions,
	} as Intl.DateTimeFormat)
}

async function importFresh() {
	vi.resetModules()
	const mod = await import('../../src/util/detect-country')
	return mod.detectCountryFromTimezone
}

describe('detectCountryFromTimezone', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns "Japan" for Asia/Tokyo', async () => {
		mockTimezone('Asia/Tokyo')
		const detect = await importFresh()
		expect(detect()).toBe('Japan')
	})

	it('returns "United States" for America/New_York', async () => {
		mockTimezone('America/New_York')
		const detect = await importFresh()
		expect(detect()).toBe('United States')
	})

	it('returns "United Kingdom" for Europe/London', async () => {
		mockTimezone('Europe/London')
		const detect = await importFresh()
		expect(detect()).toBe('United Kingdom')
	})

	it('returns empty string for unknown timezone', async () => {
		mockTimezone('Etc/GMT+9')
		const detect = await importFresh()
		expect(detect()).toBe('')
	})

	it('returns empty string for UTC', async () => {
		mockTimezone('UTC')
		const detect = await importFresh()
		expect(detect()).toBe('')
	})

	it('returns empty string when Intl.DateTimeFormat throws', async () => {
		vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
			throw new Error('not supported')
		})
		const detect = await importFresh()
		expect(detect()).toBe('')
	})

	it('caches the result across multiple calls', async () => {
		mockTimezone('Asia/Seoul')
		const detect = await importFresh()
		expect(detect()).toBe('South Korea')

		// Mock a different timezone — should still return cached value
		mockTimezone('Europe/London')
		expect(detect()).toBe('South Korea')
	})
})
