import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyVerificationStatus } from '../../entities/verified-identity'
import type { VerifyOutcome } from '../../services/identity-verification-service'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// This spec covers ONLY the identity-verification surface of SettingsRoute
// (identity-ekyc-jpki): verifyIdentity() (the Stamp entry point), the
// verification-status display getters, and loadVerificationStatus(). The route
// resolves many other services; they are left as `{}` defaults (the resolve map
// returns `{}` for unmapped tokens), which is enough to construct the VM without
// exercising those unrelated paths.

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockAuth = { isAuthenticated: true }

// Mutable `status` so the getters can be exercised across states.
const mockIdentity = {
	status: undefined as MyVerificationStatus | undefined,
	verify: vi.fn(async (): Promise<VerifyOutcome> => ({ kind: 'redirecting' })),
	getMyVerificationStatus: vi.fn(async () => ({ level: 'unverified' })),
}

const mockPush = { resolvePushState: vi.fn(async () => 'disabled') }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const map: Record<string, unknown> = {
				IIdentityVerificationService: mockIdentity,
				IAuthService: mockAuth,
				IPushService: mockPush,
				ILogger: mockLogger,
			}
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { SettingsRoute } from './settings-route'

const verifiedStatus: MyVerificationStatus = {
	level: 'identityVerified',
	identity: {
		id: 'vi-1',
		accountRef: 'user-1',
		method: 'jpki',
		pocketSignUserId: 'ps-1',
		dedupeStrength: 'strong',
		status: 'active',
	},
}

describe('SettingsRoute — identity verification', () => {
	let sut: SettingsRoute

	beforeEach(() => {
		vi.clearAllMocks()
		mockIdentity.status = undefined
		mockAuth.isAuthenticated = true
		mockIdentity.verify.mockResolvedValue({ kind: 'redirecting' })
		sut = new SettingsRoute()
	})

	describe('verifyIdentity() — Stamp entry point', () => {
		it('calls identity.verify("jpki") and handles the redirecting outcome without throwing', async () => {
			await expect(sut.verifyIdentity()).resolves.toBeUndefined()
			expect(mockIdentity.verify).toHaveBeenCalledWith('jpki')
		})

		it('handles the notAuthenticated outcome without throwing', async () => {
			mockIdentity.verify.mockResolvedValueOnce({ kind: 'notAuthenticated' })
			await expect(sut.verifyIdentity()).resolves.toBeUndefined()
			expect(mockIdentity.verify).toHaveBeenCalledWith('jpki')
		})
	})

	describe('loadVerificationStatus() (via loading())', () => {
		/** Let the fire-and-forget loads settle without awaiting loading() itself. */
		const flush = () => new Promise((r) => setTimeout(r, 0))

		it('starts the status load when authenticated', async () => {
			mockAuth.isAuthenticated = true
			sut.loading()
			await flush()
			expect(mockIdentity.getMyVerificationStatus).toHaveBeenCalledTimes(1)
		})

		it('does NOT reach the backend for a guest (unauthenticated)', async () => {
			mockAuth.isAuthenticated = false
			sut.loading()
			await flush()
			expect(mockIdentity.getMyVerificationStatus).not.toHaveBeenCalled()
		})

		it('does not block the view swap on the RPC', () => {
			mockAuth.isAuthenticated = true
			// Never resolves: if loading() awaited it, the router would hold the
			// outgoing screen for as long as the network took. Returning void is the
			// contract — Settings is a bottom-nav tab like the others.
			mockIdentity.getMyVerificationStatus.mockReturnValueOnce(
				new Promise(() => {}),
			)

			expect(sut.loading()).toBeUndefined()
		})

		it('is non-fatal — a getMyVerificationStatus failure is swallowed', async () => {
			mockAuth.isAuthenticated = true
			mockIdentity.getMyVerificationStatus.mockRejectedValueOnce(
				new Error('UNAVAILABLE'),
			)

			expect(() => sut.loading()).not.toThrow()
			// The rejection is handled inside the load routine, so nothing escapes to
			// become an unhandled rejection once it settles.
			await flush()
		})
	})

	describe('verification status display getters', () => {
		it('isIdentityVerified reflects the status level', () => {
			mockIdentity.status = undefined
			expect(sut.isIdentityVerified).toBe(false)

			mockIdentity.status = { level: 'unverified' }
			expect(sut.isIdentityVerified).toBe(false)

			mockIdentity.status = verifiedStatus
			expect(sut.isIdentityVerified).toBe(true)
		})

		it('method / dedupe keys are null until verified, then derive from the identity', () => {
			mockIdentity.status = { level: 'unverified' }
			expect(sut.verificationMethodKey).toBeNull()
			expect(sut.dedupeStrengthKey).toBeNull()

			mockIdentity.status = verifiedStatus
			expect(sut.verificationMethodKey).toBe('settings.identity.methodJpki')
			expect(sut.dedupeStrengthKey).toBe('settings.identity.dedupeStrong')
		})
	})
})
