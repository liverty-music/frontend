import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KycStatus } from '../../entities/kyc'
import type { VerifyOutcome } from '../../services/kyc-service'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// This spec covers ONLY the 本人確認 (KYC) surface of SettingsRoute
// (identity-ekyc-jpki): verifyKyc() (the Stamp entry point), the
// verification-status display getters, and loadKycStatus(). The route
// resolves many other services; they are left as `{}` defaults (the resolve map
// returns `{}` for unmapped tokens), which is enough to construct the VM without
// exercising those unrelated paths.

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockAuth = { isAuthenticated: true }

// Mutable `status` so the getters can be exercised across states.
const mockKyc = {
	status: undefined as KycStatus | undefined,
	verify: vi.fn(async (): Promise<VerifyOutcome> => ({ kind: 'redirecting' })),
	getStatus: vi.fn(async () => ({ level: 'unverified' })),
}

const mockPush = { resolvePushState: vi.fn(async () => 'disabled') }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const map: Record<string, unknown> = {
				IKycService: mockKyc,
				IAuthService: mockAuth,
				IPushService: mockPush,
				ILogger: mockLogger,
			}
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { SettingsRoute } from './settings-route'

const verifiedStatus: KycStatus = {
	level: 'kycVerified',
	kyc: {
		id: 'kyc-1',
		userId: 'user-1',
		method: 'jpki',
		pocketSignUserId: 'ps-1',
		dedupeStrength: 'strong',
		status: 'active',
	},
}

describe('SettingsRoute — KYC', () => {
	let sut: SettingsRoute

	beforeEach(() => {
		vi.clearAllMocks()
		mockKyc.status = undefined
		mockAuth.isAuthenticated = true
		mockKyc.verify.mockResolvedValue({ kind: 'redirecting' })
		sut = new SettingsRoute()
	})

	describe('verifyKyc() — Stamp entry point', () => {
		it('calls identity.verify("jpki") and handles the redirecting outcome without throwing', async () => {
			await expect(sut.verifyKyc()).resolves.toBeUndefined()
			expect(mockKyc.verify).toHaveBeenCalledWith('jpki')
		})

		it('handles the notAuthenticated outcome without throwing', async () => {
			mockKyc.verify.mockResolvedValueOnce({ kind: 'notAuthenticated' })
			await expect(sut.verifyKyc()).resolves.toBeUndefined()
			expect(mockKyc.verify).toHaveBeenCalledWith('jpki')
		})
	})

	describe('loadKycStatus() (via loading())', () => {
		/** Let the fire-and-forget loads settle without awaiting loading() itself. */
		const flush = () => new Promise((r) => setTimeout(r, 0))

		it('starts the status load when authenticated', async () => {
			mockAuth.isAuthenticated = true
			sut.loading()
			await flush()
			expect(mockKyc.getStatus).toHaveBeenCalledTimes(1)
		})

		it('does NOT reach the backend for a guest (unauthenticated)', async () => {
			mockAuth.isAuthenticated = false
			sut.loading()
			await flush()
			expect(mockKyc.getStatus).not.toHaveBeenCalled()
		})

		it('does not block the view swap on the RPC', () => {
			mockAuth.isAuthenticated = true
			// Never resolves: if loading() awaited it, the router would hold the
			// outgoing screen for as long as the network took. Returning void is the
			// contract — Settings is a bottom-nav tab like the others.
			mockKyc.getStatus.mockReturnValueOnce(new Promise(() => {}))

			expect(sut.loading()).toBeUndefined()
		})

		it('is non-fatal — a getStatus failure is swallowed', async () => {
			mockAuth.isAuthenticated = true
			mockKyc.getStatus.mockRejectedValueOnce(new Error('UNAVAILABLE'))

			expect(() => sut.loading()).not.toThrow()
			// The rejection is handled inside the load routine, so nothing escapes to
			// become an unhandled rejection once it settles.
			await flush()
		})
	})

	describe('verification status display getters', () => {
		it('isKycVerified reflects the status level', () => {
			mockKyc.status = undefined
			expect(sut.isKycVerified).toBe(false)

			mockKyc.status = { level: 'unverified' }
			expect(sut.isKycVerified).toBe(false)

			mockKyc.status = verifiedStatus
			expect(sut.isKycVerified).toBe(true)
		})

		it('method / dedupe keys are null until verified, then derive from the Kyc', () => {
			mockKyc.status = { level: 'unverified' }
			expect(sut.verificationMethodKey).toBeNull()
			expect(sut.dedupeStrengthKey).toBeNull()

			mockKyc.status = verifiedStatus
			expect(sut.verificationMethodKey).toBe('settings.kyc.methodJpki')
			expect(sut.dedupeStrengthKey).toBe('settings.kyc.dedupeStrong')
		})
	})
})
