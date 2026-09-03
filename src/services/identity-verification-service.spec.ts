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

		it('does NOT persist a session id or navigate when StartVerify throws (no partial navigation)', async () => {
			mockRpcClient.startVerify.mockRejectedValueOnce(
				new Error('UNAVAILABLE: PocketSign not configured'),
			)

			await expect(sut.verify('jpki')).rejects.toThrow('UNAVAILABLE')

			// StartVerify is awaited BEFORE saveVerifySessionId / window.location.href,
			// so a throw must leave both untouched — the browser must not navigate to a
			// half-built URL, and no stale session id may linger for the next attempt.
			expect(saveVerifySessionId).not.toHaveBeenCalled()
			expect(window.location.href).toBe('')
		})

		it('saveVerifySessionId is called BEFORE window.location.href is set (load-bearing order)', async () => {
			// The code comment in identity-verification-service.ts states this is load-bearing:
			// if window.location.href were set first the browser would navigate away and the
			// session id would never be persisted, causing every callback to sessionMismatch.
			const callOrder: string[] = []

			vi.mocked(saveVerifySessionId).mockImplementation((_id: string) => {
				callOrder.push('saveVerifySessionId')
				return true
			})

			// Intercept the href setter; it fires synchronously when the assignment happens.
			Object.defineProperty(window, 'location', {
				configurable: true,
				writable: true,
				value: {
					get href() {
						return ''
					},
					set href(_url: string) {
						callOrder.push('window.location.href')
					},
				},
			})

			await sut.verify('jpki')

			expect(callOrder).toEqual(['saveVerifySessionId', 'window.location.href'])
		})
	})

	describe('completeFromCallback (Stamp finalize — leg 2)', () => {
		it('finalizes with the PERSISTED session_id (no query param), updates status, and returns verified', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')

			// No argument: the session id comes from persisted storage, matching the
			// official flow (callbackWithSessionId=false → the callback URL has none).
			const outcome = await sut.completeFromCallback()

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

		it('returns sessionMismatch and does NOT call CompleteVerify when no session_id is persisted', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue(null)

			const outcome = await sut.completeFromCallback()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(mockRpcClient.completeVerify).not.toHaveBeenCalled()
			expect(outcome.kind).toBe('sessionMismatch')
		})

		it('always clears the persisted session_id even on a CompleteVerify failure', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')
			mockRpcClient.completeVerify.mockRejectedValueOnce(
				new Error('FAILED_PRECONDITION'),
			)

			const outcome = await sut.completeFromCallback()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(outcome.kind).toBe('verificationFailed')
		})

		it('returns verificationFailed with the error when CompleteVerify throws', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-9')
			const rpcError = new Error('FAILED_PRECONDITION: session expired')
			mockRpcClient.completeVerify.mockRejectedValueOnce(rpcError)

			const outcome = await sut.completeFromCallback()

			expect(outcome.kind).toBe('verificationFailed')
			if (outcome.kind === 'verificationFailed') {
				expect(outcome.error).toBe(rpcError)
			}
		})
	})
})
