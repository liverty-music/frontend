import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// Same pattern as `services/concert-service.spec.ts`: replace the
// `aurelia` `resolve()` export with a stub that maps DI tokens to mock
// instances by the token's `friendlyName`. ConsentService resolves both
// `ILogger` and `IEventAggregator`; the latter is the mutation publish
// channel covered by these tests.

const mockLogger = {
	scopeTo: () => ({
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}

const mockEa = {
	publish: vi.fn(),
	subscribe: vi.fn(() => ({ dispose: vi.fn() })),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IEventAggregator: mockEa,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { ConsentChanged } from './consent-changed'
import { ConsentService } from './consent-service'

const LS_KEY_STATE = 'liverty:consent:state:v1'
const LS_KEY_DEFERRED = 'liverty:consent:deferred:v1'

describe('ConsentService', () => {
	beforeEach(() => {
		localStorage.clear()
		mockEa.publish.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('hydration', () => {
		it('falls back to fail-closed defaults when localStorage is empty', () => {
			const sut = new ConsentService()

			// Fresh install: no localStorage entry → both purposes denied.
			// This is the contract `AnalyticsService` relies on to keep
			// PostHog in `persistence: 'memory'` until the user explicitly
			// grants on the consent screen.
			expect(sut.analytics).toBe(false)
			expect(sut.marketingMeasurement).toBe(false)
			expect(sut.hasDecided()).toBe(false)
		})

		it('hydrates from a valid stored payload', () => {
			localStorage.setItem(
				LS_KEY_STATE,
				JSON.stringify({
					version: 1,
					analytics: true,
					marketingMeasurement: false,
					decidedAt: '2025-04-12T10:00:00.000Z',
				}),
			)

			const sut = new ConsentService()

			// Hydration MUST NOT publish ConsentChanged — only true state
			// transitions trigger downstream side effects, otherwise
			// AnalyticsService would double-configure on every boot.
			expect(mockEa.publish).not.toHaveBeenCalled()
			expect(sut.analytics).toBe(true)
			expect(sut.marketingMeasurement).toBe(false)
			expect(sut.hasDecided()).toBe(true)
		})

		it('recovers from a corrupt JSON blob and removes it', () => {
			localStorage.setItem(LS_KEY_STATE, 'not-json{{{')

			const sut = new ConsentService()

			// Corrupt blob MUST NOT crash the app. Defaults apply and the
			// bad blob is removed so the warn does not repeat on every boot.
			expect(sut.analytics).toBe(false)
			expect(sut.marketingMeasurement).toBe(false)
			expect(sut.hasDecided()).toBe(false)
			expect(localStorage.getItem(LS_KEY_STATE)).toBeNull()
		})

		it('recovers from a schema-mismatch payload (wrong types)', () => {
			localStorage.setItem(
				LS_KEY_STATE,
				JSON.stringify({
					version: 1,
					analytics: 'yes',
					marketingMeasurement: false,
					decidedAt: null,
				}),
			)

			const sut = new ConsentService()

			expect(sut.analytics).toBe(false)
			expect(sut.marketingMeasurement).toBe(false)
		})

		it('reports hasDecided() when only the deferred flag is set', () => {
			localStorage.setItem(LS_KEY_DEFERRED, '1')

			const sut = new ConsentService()

			// Returning user who previously tapped "Set up later" — state
			// is still default-denied but the onboarding gate MUST treat
			// this as "decided" so the consent screen does not surface
			// again every boot.
			expect(sut.hasDecided()).toBe(true)
			expect(sut.analytics).toBe(false)
		})
	})

	describe('grant()', () => {
		it('flips the purpose, persists, and publishes ConsentChanged', () => {
			const sut = new ConsentService()

			sut.grant('analytics')

			expect(sut.analytics).toBe(true)
			expect(sut.marketingMeasurement).toBe(false)
			expect(sut.hasDecided()).toBe(true)

			// localStorage write: shape is the v1 schema with decidedAt
			// populated by the mutator.
			const raw = localStorage.getItem(LS_KEY_STATE)
			expect(raw).not.toBeNull()
			const stored = JSON.parse(raw ?? '{}') as Record<string, unknown>
			expect(stored).toMatchObject({
				version: 1,
				analytics: true,
				marketingMeasurement: false,
			})
			expect(typeof stored.decidedAt).toBe('string')

			// Event publish: AnalyticsService listens for this to flip
			// PostHog into localStorage+cookie persistence.
			expect(mockEa.publish).toHaveBeenCalledTimes(1)
			const event = mockEa.publish.mock.calls[0][0] as ConsentChanged
			expect(event).toBeInstanceOf(ConsentChanged)
			expect(event.state).toEqual({
				analytics: true,
				marketingMeasurement: false,
			})
		})

		it('is idempotent — re-granting the same purpose does not republish', () => {
			const sut = new ConsentService()
			sut.grant('analytics')
			mockEa.publish.mockReset()

			sut.grant('analytics')

			// No additional publish: avoids driving redundant set_config
			// calls in AnalyticsService when the settings page is opened
			// repeatedly without changing anything.
			expect(mockEa.publish).not.toHaveBeenCalled()
		})
	})

	describe('revoke()', () => {
		it('flips the purpose to false, persists, and publishes', () => {
			localStorage.setItem(
				LS_KEY_STATE,
				JSON.stringify({
					version: 1,
					analytics: true,
					marketingMeasurement: true,
					decidedAt: '2025-04-01T00:00:00.000Z',
				}),
			)
			const sut = new ConsentService()

			sut.revoke('marketingMeasurement')

			expect(sut.analytics).toBe(true)
			expect(sut.marketingMeasurement).toBe(false)

			expect(mockEa.publish).toHaveBeenCalledTimes(1)
			const event = mockEa.publish.mock.calls[0][0] as ConsentChanged
			expect(event.state).toEqual({
				analytics: true,
				marketingMeasurement: false,
			})
		})
	})

	describe('defer()', () => {
		it('marks hasDecided() without changing analytics state', () => {
			const sut = new ConsentService()

			sut.defer()

			expect(sut.hasDecided()).toBe(true)
			expect(sut.analytics).toBe(false)
			expect(sut.marketingMeasurement).toBe(false)
			// Defer must NOT publish ConsentChanged — analytics SDK posture
			// is unaffected by a deferral.
			expect(mockEa.publish).not.toHaveBeenCalled()
			expect(localStorage.getItem(LS_KEY_DEFERRED)).toBe('1')
		})

		it('is idempotent — repeated calls do not re-write or publish', () => {
			const sut = new ConsentService()
			sut.defer()

			sut.defer()

			expect(mockEa.publish).not.toHaveBeenCalled()
		})
	})
})
