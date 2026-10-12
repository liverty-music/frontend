import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdentityVerification } from '../../entities/identity-verification'
import type { VerifyOutcome } from '../../services/identity-verification-service'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// This spec covers ONLY the 本人確認 (identity verification) surface of
// SettingsRoute (identity-ekyc-jpki): startIdentityVerification() (the Stamp
// entry point), the verification-status display getters, and
// loadIdentityVerification(). The route
// resolves many other services; they are left as `{}` defaults (the resolve map
// returns `{}` for unmapped tokens), which is enough to construct the VM without
// exercising those unrelated paths.

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockAuth = { isAuthenticated: true }

// Mutable `current` so the getters can be exercised across states.
const mockIdentityVerifications = {
	current: undefined as IdentityVerification | undefined,
	start: vi.fn(async (): Promise<VerifyOutcome> => ({ kind: 'redirecting' })),
	get: vi.fn(async (): Promise<IdentityVerification | undefined> => undefined),
}

const mockPush = { resolvePushState: vi.fn(async () => 'disabled') }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const map: Record<string, unknown> = {
				IIdentityVerificationService: mockIdentityVerifications,
				IAuthService: mockAuth,
				IPushService: mockPush,
				ILogger: mockLogger,
			}
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { SettingsRoute } from './settings-route'

const activeIdentityVerification: IdentityVerification = {
	id: 'iv-1',
	userId: 'user-1',
	method: 'jpki',
	providerUserId: 'provider-1',
	dedupeStrength: 'strong',
	status: 'active',
}

describe('SettingsRoute — identity verification', () => {
	let sut: SettingsRoute

	beforeEach(() => {
		vi.clearAllMocks()
		mockIdentityVerifications.current = undefined
		mockAuth.isAuthenticated = true
		mockIdentityVerifications.start.mockResolvedValue({ kind: 'redirecting' })
		sut = new SettingsRoute()
	})

	describe('startIdentityVerification() — Stamp entry point', () => {
		it('calls identityVerifications.start("jpki") and handles the redirecting outcome without throwing', async () => {
			await expect(sut.startIdentityVerification()).resolves.toBeUndefined()
			expect(mockIdentityVerifications.start).toHaveBeenCalledWith('jpki')
		})

		it('handles the notAuthenticated outcome without throwing', async () => {
			mockIdentityVerifications.start.mockResolvedValueOnce({
				kind: 'notAuthenticated',
			})
			await expect(sut.startIdentityVerification()).resolves.toBeUndefined()
			expect(mockIdentityVerifications.start).toHaveBeenCalledWith('jpki')
		})
	})

	describe('loadIdentityVerification() (via loading())', () => {
		/** Let the fire-and-forget loads settle without awaiting loading() itself. */
		const flush = () => new Promise((r) => setTimeout(r, 0))

		it('starts the status load when authenticated', async () => {
			mockAuth.isAuthenticated = true
			sut.loading()
			await flush()
			expect(mockIdentityVerifications.get).toHaveBeenCalledTimes(1)
		})

		it('does NOT reach the backend for a guest (unauthenticated)', async () => {
			mockAuth.isAuthenticated = false
			sut.loading()
			await flush()
			expect(mockIdentityVerifications.get).not.toHaveBeenCalled()
		})

		it('does not block the view swap on the RPC', () => {
			mockAuth.isAuthenticated = true
			// Never resolves: if loading() awaited it, the router would hold the
			// outgoing screen for as long as the network took. Returning void is the
			// contract — Settings is a bottom-nav tab like the others.
			mockIdentityVerifications.get.mockReturnValueOnce(new Promise(() => {}))

			expect(sut.loading()).toBeUndefined()
		})

		it('is non-fatal — a get failure is swallowed', async () => {
			mockAuth.isAuthenticated = true
			mockIdentityVerifications.get.mockRejectedValueOnce(
				new Error('UNAVAILABLE'),
			)

			expect(() => sut.loading()).not.toThrow()
			// The rejection is handled inside the load routine, so nothing escapes to
			// become an unhandled rejection once it settles.
			await flush()
		})
	})

	describe('verification status display getters', () => {
		it('isVerified is true only for an Active IdentityVerification', () => {
			mockIdentityVerifications.current = undefined
			expect(sut.isVerified).toBe(false)

			mockIdentityVerifications.current = {
				...activeIdentityVerification,
				status: 'needsReverification',
			}
			expect(sut.isVerified).toBe(false)

			mockIdentityVerifications.current = activeIdentityVerification
			expect(sut.isVerified).toBe(true)
		})

		it('method / dedupe keys are null until verified, then derive from the IdentityVerification', () => {
			mockIdentityVerifications.current = undefined
			expect(sut.verificationMethodKey).toBeNull()
			expect(sut.dedupeStrengthKey).toBeNull()

			mockIdentityVerifications.current = activeIdentityVerification
			expect(sut.verificationMethodKey).toBe(
				'settings.identityVerification.methodJpki',
			)
			expect(sut.dedupeStrengthKey).toBe(
				'settings.identityVerification.dedupeStrong',
			)
		})
	})
})
