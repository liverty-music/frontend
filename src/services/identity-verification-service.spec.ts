import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from '../adapter/storage/verify-session-storage'
import type { IdentityVerification } from '../entities/identity-verification'

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

const activeIdentityVerification: IdentityVerification = {
	id: 'iv-1',
	userId: 'user-1',
	method: 'jpki',
	providerUserId: 'provider-user-1',
	dedupeStrength: 'strong',
	status: 'active',
}

const mockRpcClient = {
	get: vi.fn(async (): Promise<IdentityVerification | undefined> => undefined),
	start: vi.fn(
		async (): Promise<{ sessionId: string; redirectUrl: string }> => ({
			sessionId: 'sess-1',
			redirectUrl: 'https://pocketsign.example.com/stamp/sess-1',
		}),
	),
	create: vi.fn(
		async (): Promise<IdentityVerification | undefined> =>
			activeIdentityVerification,
	),
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

import { isVerified } from '../entities/identity-verification'
import { IdentityVerificationService } from './identity-verification-service'

describe('IdentityVerificationService', () => {
	let sut: IdentityVerificationService

	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockRpcClient.get.mockResolvedValue(undefined)
		mockRpcClient.start.mockResolvedValue({
			sessionId: 'sess-1',
			redirectUrl: 'https://pocketsign.example.com/stamp/sess-1',
		})
		mockRpcClient.create.mockResolvedValue(activeIdentityVerification)
		vi.mocked(loadVerifySessionId).mockReturnValue(null)
		sut = new IdentityVerificationService()
	})

	describe('get', () => {
		it('reads the IdentityVerification over RPC for a signed-in fan', async () => {
			mockRpcClient.get.mockResolvedValueOnce(activeIdentityVerification)

			const result = await sut.get()

			expect(mockRpcClient.get).toHaveBeenCalledWith(undefined)
			expect(result).toEqual(activeIdentityVerification)
			expect(isVerified(result)).toBe(true)
			expect(sut.current).toEqual(activeIdentityVerification)
			expect(sut.loaded).toBe(true)
		})

		it('is unverified when the fan never verified', async () => {
			const result = await sut.get()

			expect(result).toBeUndefined()
			expect(isVerified(result)).toBe(false)
		})

		it('is unverified when the IdentityVerification needs re-verification', async () => {
			const stale: IdentityVerification = {
				...activeIdentityVerification,
				status: 'needsReverification',
			}
			mockRpcClient.get.mockResolvedValueOnce(stale)

			const result = await sut.get()

			expect(result).toEqual(stale)
			expect(isVerified(result)).toBe(false)
		})

		it('resolves nothing without an RPC for a guest', async () => {
			mockAuth.isAuthenticated = false

			const result = await sut.get()

			expect(mockRpcClient.get).not.toHaveBeenCalled()
			expect(result).toBeUndefined()
			expect(sut.loaded).toBe(true)
		})
	})

	describe('SignedOut', () => {
		it('forgets the previous account snapshot', async () => {
			mockRpcClient.get.mockResolvedValueOnce(activeIdentityVerification)
			await sut.get()

			signedOutHandler?.()

			expect(sut.current).toBeUndefined()
			expect(sut.loaded).toBe(false)
		})

		it('forgets the previous account callback result', () => {
			sut.settle('notCompleted')
			sut.settle(null)

			signedOutHandler?.()

			expect(sut.failure).toBeNull()
			expect(sut.takeVerifiedNotice()).toBe(false)
		})
	})

	describe('settle (the callback hands its result to Settings)', () => {
		it('keeps a failure reason and announces nothing', () => {
			sut.settle('unavailable')

			expect(sut.failure).toBe('unavailable')
			expect(sut.takeVerifiedNotice()).toBe(false)
		})

		it('announces a success exactly once and clears an earlier reason', () => {
			sut.settle('notCompleted')
			sut.settle(null)

			expect(sut.failure).toBeNull()
			expect(sut.takeVerifiedNotice()).toBe(true)
			expect(sut.takeVerifiedNotice()).toBe(false)
		})

		it('@spec components/infrastructure/fan/web/route/settings "Retry clears the reason"', async () => {
			sut.settle('notCompleted')

			await sut.start('jpki')

			expect(sut.failure).toBeNull()
		})
	})

	describe('start (Stamp redirect — leg 1)', () => {
		it('calls IdentityVerificationService.Start, persists the session_id, and sets window.location.href', async () => {
			const outcome = await sut.start('jpki')

			expect(mockRpcClient.start).toHaveBeenCalledWith('jpki', undefined)
			expect(saveVerifySessionId).toHaveBeenCalledWith('sess-1')
			expect(window.location.href).toBe(
				'https://pocketsign.example.com/stamp/sess-1',
			)
			expect(outcome.kind).toBe('redirecting')
		})

		it('returns notAuthenticated for a guest without calling Start', async () => {
			mockAuth.isAuthenticated = false

			const outcome = await sut.start('jpki')

			expect(outcome.kind).toBe('notAuthenticated')
			expect(mockRpcClient.start).not.toHaveBeenCalled()
			expect(saveVerifySessionId).not.toHaveBeenCalled()
		})

		it('propagates a ConnectError from Start (UNAVAILABLE etc.) to the caller', async () => {
			mockRpcClient.start.mockRejectedValueOnce(
				new Error('UNAVAILABLE: PocketSign not configured'),
			)

			await expect(sut.start('jpki')).rejects.toThrow('UNAVAILABLE')
		})

		it('does NOT persist a session id or navigate when Start throws (no partial navigation)', async () => {
			mockRpcClient.start.mockRejectedValueOnce(
				new Error('UNAVAILABLE: PocketSign not configured'),
			)

			await expect(sut.start('jpki')).rejects.toThrow('UNAVAILABLE')

			// Start is awaited BEFORE saveVerifySessionId / window.location.href,
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

			await sut.start('jpki')

			expect(callOrder).toEqual(['saveVerifySessionId', 'window.location.href'])
		})
	})

	describe('create (Stamp finalize — leg 2)', () => {
		it('finalizes with the PERSISTED session_id (no query param), updates current, and returns verified', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')

			// No argument: the session id comes from persisted storage, matching the
			// official flow (callbackWithSessionId=false → the callback URL has none).
			const outcome = await sut.create()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(mockRpcClient.create).toHaveBeenCalledWith('sess-1', undefined)
			expect(outcome.kind).toBe('verified')
			if (outcome.kind === 'verified') {
				expect(outcome.identityVerification).toBe(activeIdentityVerification)
			}
			expect(sut.current).toBe(activeIdentityVerification)
			expect(sut.loaded).toBe(true)
		})

		it('returns sessionMismatch and does NOT call Create when no session_id is persisted', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue(null)

			const outcome = await sut.create()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(mockRpcClient.create).not.toHaveBeenCalled()
			expect(outcome.kind).toBe('sessionMismatch')
		})

		it('always clears the persisted session_id even on a Create failure', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-1')
			mockRpcClient.create.mockRejectedValueOnce(
				new Error('FAILED_PRECONDITION'),
			)

			const outcome = await sut.create()

			expect(clearVerifySessionId).toHaveBeenCalled()
			expect(outcome.kind).toBe('verificationFailed')
		})

		it('returns verificationFailed with the error when Create throws', async () => {
			vi.mocked(loadVerifySessionId).mockReturnValue('sess-9')
			const rpcError = new Error('FAILED_PRECONDITION: session expired')
			mockRpcClient.create.mockRejectedValueOnce(rpcError)

			const outcome = await sut.create()

			expect(outcome.kind).toBe('verificationFailed')
			if (outcome.kind === 'verificationFailed') {
				expect(outcome.error).toBe(rpcError)
			}
		})
	})
})
