import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from '../adapter/storage/verify-session-storage'
import type { MyVerificationStatus } from '../entities/verified-identity'

// ── Storage adapter mocks ──────────────────────────────────────────────────

vi.mock('../adapter/storage/verify-session-storage', () => ({
	saveVerifySessionId: vi.fn(() => true),
	loadVerifySessionId: vi.fn(() => null),
	clearVerifySessionId: vi.fn(),
}))

// ── Service dependency mocks ───────────────────────────────────────────────

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
		async (): Promise<{ sessionId: string; redirectUrl: string }> => ({
			sessionId: 'sess-1',
			redirectUrl: 'https://pocketsign.example.com/stamp/sess-1',
		}),
	),
	completeVerify: vi.fn(async (): Promise<MyVerificationStatus> => verified),
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
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

// Mock window.location for redirect assertions
const originalLocation = window.location
beforeEach(() => {
	Object.defineProperty(window, 'location', {
		configurable: true,
		writable: true,
		value: { href: '' },
	})
})
afterEach(() => {
	Object.defineProperty(window, 'location', {
		configurable: true,
		writable: true,
		value: originalLocation,
	})
})

import { IdentityVerificationService } from './identity-verification-service'

describe('IdentityVerificationService', () => {
	let sut: IdentityVerificationService

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockUserStore.current = { id: 'user-1' }
		mockRpcClient.getMyVerificationStatus.mockResolvedValue(unverified)
		mockRpcClient.startVerify.mockResolvedValue({
			sessionId: 'sess-1',
			redirectUrl: 'https://pocketsign.example.com/stamp/sess-1',
		})
		mockRpcClient.completeVerify.mockResolvedValue(verified)
		vi.mocked(loadVerifySessionId).mockReturnValue(null)
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

	describe('verify (Stamp redirect — leg 1)', () => {
		it('calls StartVerify, persists the session_id, and sets window.location.href', async () => {
			const outcome = await sut.verify('jpki')

			expect(mockRpcClient.startVerify).toHaveBeenCalledWith(
				'user-1',
				'jpki',
				undefined,
			)
			expect(saveVerifySessionId).toHaveBeenCalledWith('sess-1')
			expect(window.location.href).toBe(
				'https://pocketsign.example.com/stamp/sess-1',
			)
			expect(outcome.kind).toBe('redirecting')
		})

		it('returns notAuthenticated for a guest without calling StartVerify', async () => {
			mockAuth.isAuthenticated = false

			const outcome = await sut.verify('jpki')

			expect(outcome.kind).toBe('notAuthenticated')
			expect(mockRpcClient.startVerify).not.toHaveBeenCalled()
			expect(saveVerifySessionId).not.toHaveBeenCalled()
		})

		it('propagates a ConnectError from StartVerify (UNAVAILABLE etc.) to the caller', async () => {
			mockRpcClient.startVerify.mockRejectedValueOnce(
				new Error('UNAVAILABLE: PocketSign not configured'),
			)

			await expect(sut.verify('jpki')).rejects.toThrow('UNAVAILABLE')
		})
	})

	describe('completeFromCallback (Stamp finalize — leg 2)', () => {
		it('validates session_id, calls CompleteVerify, updates status, and returns verified', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')

			const outcome = await sut.completeFromCallback('sess-1')

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(mockRpcClient.completeVerify).toHaveBeenCalledWith(
				'user-1',
				'sess-1',
				undefined,
			)
			expect(outcome.kind).toBe('verified')
			if (outcome.kind === 'verified') {
				expect(outcome.status).toBe(verified)
			}
			expect(sut.status).toBe(verified)
			expect(sut.loaded).toBe(true)
		})

		it('returns sessionMismatch when the callback session_id differs from persisted', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-ORIGINAL')

			const outcome = await sut.completeFromCallback('sess-TAMPERED')

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(mockRpcClient.completeVerify).not.toHaveBeenCalled()
			expect(outcome.kind).toBe('sessionMismatch')
		})

		it('returns sessionMismatch when no session_id is persisted (e.g. storage unavailable)', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue(null)

			const outcome = await sut.completeFromCallback('sess-1')

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(outcome.kind).toBe('sessionMismatch')
		})

		it('always clears the persisted session_id even on a CompleteVerify failure', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')
			mockRpcClient.completeVerify.mockRejectedValueOnce(
				new Error('FAILED_PRECONDITION'),
			)

			const outcome = await sut.completeFromCallback('sess-1')

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(outcome.kind).toBe('verificationFailed')
		})

		it('returns verificationFailed with the error when CompleteVerify throws', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-9')
			const rpcError = new Error('FAILED_PRECONDITION: session expired')
			mockRpcClient.completeVerify.mockRejectedValueOnce(rpcError)

			const outcome = await sut.completeFromCallback('sess-9')

			expect(outcome.kind).toBe('verificationFailed')
			if (outcome.kind === 'verificationFailed') {
				expect(outcome.error).toBe(rpcError)
			}
		})
	})
})
