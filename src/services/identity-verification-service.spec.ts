import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PocketSignUnavailableError } from '../adapter/pocket-sign/pocket-sign-verify-client'
import type { MyVerificationStatus } from '../entities/verified-identity'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockUserStore = {
	current: { id: 'user-1' } as { id: string } | undefined,
}

const unverified: MyVerificationStatus = { level: 'unverified' }
const verified: MyVerificationStatus = {
	level: 'identityVerified',
	identity: {
		id: 'vi-1',
		accountRef: 'user-1',
		method: 'jpki',
		pocketSignUserId: 'ps-user-1',
		dedupeStrength: 'strong',
		status: 'active',
	},
}

const mockRpcClient = {
	getMyVerificationStatus: vi.fn(
		async (): Promise<MyVerificationStatus> => unverified,
	),
	startVerify: vi.fn(
		async (): Promise<{ sessionId: string; challenge: Uint8Array }> => ({
			sessionId: 'sess-1',
			challenge: new Uint8Array([1, 2, 3]),
		}),
	),
	completeVerify: vi.fn(async (): Promise<MyVerificationStatus> => verified),
}

const mockPocketSign = {
	isAvailable: false,
	readCard: vi.fn(async (): Promise<Uint8Array> => new Uint8Array([9])),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: mockAuth,
				IUserStore: mockUserStore,
				IIdentityVerificationRpcClient: mockRpcClient,
				IPocketSignVerifyClient: mockPocketSign,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

import { IdentityVerificationService } from './identity-verification-service'

describe('IdentityVerificationService', () => {
	let sut: IdentityVerificationService

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockUserStore.current = { id: 'user-1' }
		mockPocketSign.isAvailable = false
		mockRpcClient.getMyVerificationStatus.mockResolvedValue(unverified)
		mockRpcClient.completeVerify.mockResolvedValue(verified)
		sut = new IdentityVerificationService()
	})

	describe('getMyVerificationStatus', () => {
		it('reads status over RPC and stores it on the observable for an authed user', async () => {
			mockRpcClient.getMyVerificationStatus.mockResolvedValueOnce(verified)

			const result = await sut.getMyVerificationStatus()

			expect(mockRpcClient.getMyVerificationStatus).toHaveBeenCalledWith(
				'user-1',
				undefined,
			)
			expect(result).toBe(verified)
			expect(sut.status).toBe(verified)
			expect(sut.loaded).toBe(true)
		})

		it('returns an unverified snapshot without an RPC for a guest', async () => {
			mockAuth.isAuthenticated = false

			const result = await sut.getMyVerificationStatus()

			expect(mockRpcClient.getMyVerificationStatus).not.toHaveBeenCalled()
			expect(result.level).toBe('unverified')
			expect(sut.loaded).toBe(true)
		})
	})

	describe('verifyAvailable', () => {
		it('reflects the Pocket Sign seam availability', () => {
			expect(sut.verifyAvailable).toBe(false)
			mockPocketSign.isAvailable = true
			expect(sut.verifyAvailable).toBe(true)
		})
	})

	describe('verify (orchestration)', () => {
		it('short-circuits to vendorUnavailable when the SDK is the stub — no RPC', async () => {
			const outcome = await sut.verify('jpki')

			expect(outcome.kind).toBe('vendorUnavailable')
			expect(mockRpcClient.startVerify).not.toHaveBeenCalled()
			expect(mockPocketSign.readCard).not.toHaveBeenCalled()
		})

		it('returns notAuthenticated for a guest without touching the vendor', async () => {
			mockAuth.isAuthenticated = false

			const outcome = await sut.verify('jpki')

			expect(outcome.kind).toBe('notAuthenticated')
			expect(mockRpcClient.startVerify).not.toHaveBeenCalled()
		})

		it('runs the full challenge–response when the SDK is available', async () => {
			mockPocketSign.isAvailable = true

			const outcome = await sut.verify('jpki')

			expect(mockRpcClient.startVerify).toHaveBeenCalledWith(
				'user-1',
				'jpki',
				undefined,
			)
			expect(mockPocketSign.readCard).toHaveBeenCalledWith(
				'jpki',
				new Uint8Array([1, 2, 3]),
			)
			expect(mockRpcClient.completeVerify).toHaveBeenCalledWith(
				'user-1',
				'sess-1',
				new Uint8Array([9]),
				undefined,
			)
			expect(outcome).toEqual({ kind: 'verified', status: verified })
			expect(sut.status).toBe(verified)
		})

		it('maps a PocketSignUnavailableError from the SDK to vendorUnavailable', async () => {
			mockPocketSign.isAvailable = true
			mockPocketSign.readCard.mockRejectedValueOnce(
				new PocketSignUnavailableError(),
			)

			const outcome = await sut.verify('jpki')

			expect(outcome.kind).toBe('vendorUnavailable')
		})

		it('rethrows a non-vendor error (e.g. an RPC failure)', async () => {
			mockPocketSign.isAvailable = true
			mockRpcClient.startVerify.mockRejectedValueOnce(new Error('UNAVAILABLE'))

			await expect(sut.verify('jpki')).rejects.toThrow('UNAVAILABLE')
		})
	})

	describe('startVerify / completeVerify (direct)', () => {
		it('startVerify forwards the userId + method to the RPC client', async () => {
			await sut.startVerify('jpki')
			expect(mockRpcClient.startVerify).toHaveBeenCalledWith(
				'user-1',
				'jpki',
				undefined,
			)
		})

		it('completeVerify forwards the session + response and updates status', async () => {
			const result = await sut.completeVerify('sess-9', new Uint8Array([7]))
			expect(mockRpcClient.completeVerify).toHaveBeenCalledWith(
				'user-1',
				'sess-9',
				new Uint8Array([7]),
				undefined,
			)
			expect(result).toBe(verified)
			expect(sut.status).toBe(verified)
		})

		it('startVerify throws for a guest (no account to verify)', async () => {
			mockAuth.isAuthenticated = false
			await expect(sut.startVerify('jpki')).rejects.toThrow(
				/authenticated user account/,
			)
		})
	})
})
