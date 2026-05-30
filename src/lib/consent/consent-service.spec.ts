import { describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// Same pattern as `services/concert-service.spec.ts`: replace the
// `aurelia` `resolve()` export with a stub that maps DI tokens to mock
// instances by the token's `friendlyName`. ConsentServiceStub only
// resolves `ILogger`, so the mock map is tiny.

const mockLogger = {
	scopeTo: () => ({
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { ConsentServiceStub } from './consent-service'

describe('ConsentServiceStub', () => {
	it('reports analytics consent as denied (Batch 3a fail-closed default)', () => {
		const sut = new ConsentServiceStub()

		// The 3a stub MUST return false until the 3b consent screen
		// flips it via `grant('analytics')`. Any regression here would
		// silently turn on PostHog identification before the user has
		// agreed, violating the OpenSpec consent requirements.
		expect(sut.analytics).toBe(false)
	})

	it('reports marketingMeasurement consent as denied (Batch 3a fail-closed default)', () => {
		const sut = new ConsentServiceStub()

		// `marketingMeasurement` is the APPI Article 28 cross-border
		// transfer purpose. It MUST stay false in 3a so AnalyticsService
		// cannot enable the marketing-funnel cross-border data flow
		// before the user grants explicit, granular consent.
		expect(sut.marketingMeasurement).toBe(false)
	})
})
