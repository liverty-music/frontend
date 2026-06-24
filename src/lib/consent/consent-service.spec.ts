import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// Replace the `aurelia` `resolve()` export with a stub that maps DI tokens
// to mock instances by the token's `friendlyName`. ConsentService resolves
// both `ILogger` and `IEventAggregator`; the latter is the mutation publish
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

const LS_KEY_STATE_V2 = 'liverty:consent:state:v2'
const LS_KEY_STATE_V1 = 'liverty:consent:state:v1'
const LS_KEY_DEFERRED_V1 = 'liverty:consent:deferred:v1'

describe('ConsentService', () => {
	beforeEach(() => {
		localStorage.clear()
		mockEa.publish.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('hydration', () => {
		it('defaults BOTH purposes ON when localStorage is empty (opt-out model)', () => {
			const sut = new ConsentService()

			// Fresh install: no stored decision → default-on. This is the
			// contract `AnalyticsService` relies on to capture the full
			// catalogue and identify by default until the user opts out.
			expect(sut.analytics).toBe(true)
			expect(sut.sessionReplay).toBe(true)
		})

		it('hydrates from a valid stored v2 payload', () => {
			localStorage.setItem(
				LS_KEY_STATE_V2,
				JSON.stringify({
					version: 2,
					analytics: false,
					sessionReplay: true,
				}),
			)

			const sut = new ConsentService()

			// Hydration MUST NOT publish ConsentChanged — only true state
			// transitions trigger downstream side effects.
			expect(mockEa.publish).not.toHaveBeenCalled()
			expect(sut.analytics).toBe(false)
			expect(sut.sessionReplay).toBe(true)
		})

		it('migrates a legacy v1 payload to default-on v2 and removes the v1 keys', () => {
			localStorage.setItem(
				LS_KEY_STATE_V1,
				JSON.stringify({
					version: 1,
					analytics: false,
					marketingMeasurement: false,
					decidedAt: '2025-04-12T10:00:00.000Z',
				}),
			)
			localStorage.setItem(LS_KEY_DEFERRED_V1, '1')

			const sut = new ConsentService()

			// Pre-launch: no opt-in/decline state to preserve → re-default to
			// on. This is a clean version migration, not a silent wipe.
			expect(sut.analytics).toBe(true)
			expect(sut.sessionReplay).toBe(true)
			// Legacy keys removed; a v2 payload is written in their place.
			expect(localStorage.getItem(LS_KEY_STATE_V1)).toBeNull()
			expect(localStorage.getItem(LS_KEY_DEFERRED_V1)).toBeNull()
			const raw = localStorage.getItem(LS_KEY_STATE_V2)
			expect(raw).not.toBeNull()
			const stored = JSON.parse(raw ?? '{}') as Record<string, unknown>
			expect(stored).toEqual({
				version: 2,
				analytics: true,
				sessionReplay: true,
			})
			// Migration during hydration MUST NOT publish ConsentChanged.
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('recovers from a corrupt JSON blob and removes it (default-on)', () => {
			localStorage.setItem(LS_KEY_STATE_V2, 'not-json{{{')

			const sut = new ConsentService()

			// Corrupt blob MUST NOT crash the app. Default-on posture applies
			// and the bad blob is removed so the warn does not repeat.
			expect(sut.analytics).toBe(true)
			expect(sut.sessionReplay).toBe(true)
			expect(localStorage.getItem(LS_KEY_STATE_V2)).toBeNull()
		})

		it('recovers from a schema-mismatch payload (wrong types)', () => {
			localStorage.setItem(
				LS_KEY_STATE_V2,
				JSON.stringify({
					version: 2,
					analytics: 'yes',
					sessionReplay: false,
				}),
			)

			const sut = new ConsentService()

			expect(sut.analytics).toBe(true)
			expect(sut.sessionReplay).toBe(true)
		})
	})

	describe('revoke() — opting out', () => {
		it('flips the purpose to false, persists, and publishes', () => {
			const sut = new ConsentService()

			sut.revoke('analytics')

			expect(sut.analytics).toBe(false)
			expect(sut.sessionReplay).toBe(true)

			const raw = localStorage.getItem(LS_KEY_STATE_V2)
			expect(raw).not.toBeNull()
			const stored = JSON.parse(raw ?? '{}') as Record<string, unknown>
			expect(stored).toEqual({
				version: 2,
				analytics: false,
				sessionReplay: true,
			})

			// AnalyticsService listens for this to opt out of capturing.
			expect(mockEa.publish).toHaveBeenCalledTimes(1)
			const event = mockEa.publish.mock.calls[0][0] as ConsentChanged
			expect(event).toBeInstanceOf(ConsentChanged)
			expect(event.state).toEqual({ analytics: false, sessionReplay: true })
		})

		it('opts out of sessionReplay independently of analytics', () => {
			const sut = new ConsentService()

			sut.revoke('sessionReplay')

			expect(sut.analytics).toBe(true)
			expect(sut.sessionReplay).toBe(false)
			expect(mockEa.publish).toHaveBeenCalledTimes(1)
			const event = mockEa.publish.mock.calls[0][0] as ConsentChanged
			expect(event.state).toEqual({ analytics: true, sessionReplay: false })
		})

		it('is a full no-op when the value is already at its current state', () => {
			const sut = new ConsentService()
			// Already opted out.
			sut.revoke('analytics')
			mockEa.publish.mockReset()

			sut.revoke('analytics')

			// Re-revoking an already-off purpose must not republish — a
			// spurious republish would drive redundant SDK reconfiguration.
			expect(mockEa.publish).not.toHaveBeenCalled()
		})
	})

	describe('grant() — opting back in', () => {
		it('re-enables a previously opted-out purpose, persists, and publishes', () => {
			localStorage.setItem(
				LS_KEY_STATE_V2,
				JSON.stringify({
					version: 2,
					analytics: false,
					sessionReplay: false,
				}),
			)
			const sut = new ConsentService()

			sut.grant('analytics')

			expect(sut.analytics).toBe(true)
			expect(sut.sessionReplay).toBe(false)
			expect(mockEa.publish).toHaveBeenCalledTimes(1)
			const event = mockEa.publish.mock.calls[0][0] as ConsentChanged
			expect(event.state).toEqual({ analytics: true, sessionReplay: false })
		})

		it('is idempotent — re-granting an already-on purpose does not republish', () => {
			const sut = new ConsentService()
			// Default-on already.
			sut.grant('analytics')

			expect(mockEa.publish).not.toHaveBeenCalled()
		})
	})
})
