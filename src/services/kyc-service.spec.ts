import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from '../adapter/storage/verify-session-storage'
import type { Kyc, KycStatus } from '../entities/kyc'

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
// Captures the SignedOut handler the service subscribes in its constructor.
let signedOutHandler: (() => void) | undefined
const mockEa = {
	subscribe: vi.fn((_event: unknown, handler: () => void) => {
		signedOutHandler = handler
		return { dispose: vi.fn() }
	}),
}

const activeKyc: Kyc = {
	id: 'kyc-1',
	userId: 'user-1',
	method: 'jpki',
	pocketSignUserId: 'ps-user-1',
	dedupeStrength: 'strong',
	status: 'active',
}
const verified: KycStatus = { level: 'kycVerified', kyc: activeKyc }

const mockRpcClient = {
	get: vi.fn(async (): Promise<Kyc | undefined> => undefined),
	start: vi.fn(
		async (): Promise<{ sessionId: string; redirectUrl: string }> => ({
			sessionId: 'sess-1',
			redirectUrl: 'https://pocketsign.example.com/stamp/sess-1',
		}),
	),
	create: vi.fn(async (): Promise<KycStatus> => verified),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: mockAuth,
				IEventAggregator: mockEa,
				IKycRpcClient: mockRpcClient,
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

import { KycService } from './kyc-service'

describe('KycService', () => {
	let sut: KycService

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockRpcClient.get.mockResolvedValue(undefined)
		mockRpcClient.start.mockResolvedValue({
			sessionId: 'sess-1',
			redirectUrl: 'https://pocketsign.example.com/stamp/sess-1',
		})
		mockRpcClient.create.mockResolvedValue(verified)
		vi.mocked(loadVerifySessionId).mockReturnValue(null)
		sut = new KycService()
	})

	describe('getStatus', () => {
		it('reads the Kyc over RPC and derives the level for a signed-in fan', async () => {
			mockRpcClient.get.mockResolvedValueOnce(activeKyc)

			const result = await sut.getStatus()

			expect(mockRpcClient.get).toHaveBeenCalledWith(undefined)
			expect(result).toEqual(verified)
			expect(sut.status).toEqual(verified)
			expect(sut.loaded).toBe(true)
		})

		it('is unverified when the fan never passed KYC', async () => {
			const result = await sut.getStatus()

			expect(result).toEqual({ level: 'unverified' })
		})

		it('is unverified, with the Kyc, when the Kyc needs re-verification', async () => {
			const stale: Kyc = { ...activeKyc, status: 'needsReverification' }
			mockRpcClient.get.mockResolvedValueOnce(stale)

			const result = await sut.getStatus()

			expect(result).toEqual({ level: 'unverified', kyc: stale })
		})

		it('returns an unverified snapshot without an RPC for a guest', async () => {
			mockAuth.isAuthenticated = false

			const result = await sut.getStatus()

			expect(mockRpcClient.get).not.toHaveBeenCalled()
			expect(result.level).toBe('unverified')
			expect(sut.loaded).toBe(true)
		})
	})

	describe('SignedOut', () => {
		it('forgets the previous account snapshot', async () => {
			mockRpcClient.get.mockResolvedValueOnce(activeKyc)
			await sut.getStatus()

			signedOutHandler?.()

			expect(sut.status).toBeUndefined()
			expect(sut.loaded).toBe(false)
		})
	})

	describe('verify (Stamp redirect — leg 1)', () => {
		it('calls KycService.Start, persists the session_id, and sets window.location.href', async () => {
			const outcome = await sut.verify('jpki')

			expect(mockRpcClient.start).toHaveBeenCalledWith('jpki', undefined)
			expect(saveVerifySessionId).toHaveBeenCalledWith('sess-1')
			expect(window.location.href).toBe(
				'https://pocketsign.example.com/stamp/sess-1',
			)
			expect(outcome.kind).toBe('redirecting')
		})

		it('returns notAuthenticated for a guest without calling Start', async () => {
			mockAuth.isAuthenticated = false

			const outcome = await sut.verify('jpki')

			expect(outcome.kind).toBe('notAuthenticated')
			expect(mockRpcClient.start).not.toHaveBeenCalled()
			expect(saveVerifySessionId).not.toHaveBeenCalled()
		})

		it('propagates a ConnectError from Start (UNAVAILABLE etc.) to the caller', async () => {
			mockRpcClient.start.mockRejectedValueOnce(
				new Error('UNAVAILABLE: PocketSign not configured'),
			)

			await expect(sut.verify('jpki')).rejects.toThrow('UNAVAILABLE')
		})

		it('does NOT persist a session id or navigate when Start throws (no partial navigation)', async () => {
			mockRpcClient.start.mockRejectedValueOnce(
				new Error('UNAVAILABLE: PocketSign not configured'),
			)

			await expect(sut.verify('jpki')).rejects.toThrow('UNAVAILABLE')

			// Start is awaited BEFORE saveVerifySessionId / window.location.href,
			// so a throw must leave both untouched — the browser must not navigate to a
			// half-built URL, and no stale session id may linger for the next attempt.
			expect(saveVerifySessionId).not.toHaveBeenCalled()
			expect(window.location.href).toBe('')
		})

		it('saveVerifySessionId is called BEFORE window.location.href is set (load-bearing order)', async () => {
			// The code comment in kyc-service.ts states this is load-bearing:
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
			expect(mockRpcClient.create).toHaveBeenCalledWith('sess-1', undefined)
			expect(outcome.kind).toBe('verified')
			if (outcome.kind === 'verified') {
				expect(outcome.status).toBe(verified)
			}
			expect(sut.status).toBe(verified)
			expect(sut.loaded).toBe(true)
		})

		it('returns sessionMismatch and does NOT call Create when no session_id is persisted', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue(null)

			const outcome = await sut.completeFromCallback()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(mockRpcClient.create).not.toHaveBeenCalled()
			expect(outcome.kind).toBe('sessionMismatch')
		})

		it('always clears the persisted session_id even on a Create failure', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')
			mockRpcClient.create.mockRejectedValueOnce(
				new Error('FAILED_PRECONDITION'),
			)

			const outcome = await sut.completeFromCallback()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(outcome.kind).toBe('verificationFailed')
		})

		it('returns verificationFailed with the error when Create throws', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-9')
			const rpcError = new Error('FAILED_PRECONDITION: session expired')
			mockRpcClient.create.mockRejectedValueOnce(rpcError)

			const outcome = await sut.completeFromCallback()

			expect(outcome.kind).toBe('verificationFailed')
			if (outcome.kind === 'verificationFailed') {
				expect(outcome.error).toBe(rpcError)
			}
		})
	})
})
