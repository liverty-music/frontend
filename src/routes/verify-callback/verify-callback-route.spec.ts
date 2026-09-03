import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteOutcome } from '../../services/identity-verification-service'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockRouter = { load: vi.fn(async () => {}) }
const mockI18n = { tr: vi.fn((key: string) => key) }

// completeFromCallback takes NO session id argument: the service reads it from
// its own persisted storage (callbackWithSessionId=false → no query param).
const mockCompleteFromCallback = vi.fn(
	async (_signal?: AbortSignal): Promise<CompleteOutcome> =>
		({ kind: 'sessionMismatch' }) as CompleteOutcome,
)

const mockIdentityService = {
	completeFromCallback: mockCompleteFromCallback,
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const map: Record<string, unknown> = {
				IIdentityVerificationService: mockIdentityService,
				IRouter: mockRouter,
				I18N: mockI18n,
				ILogger: mockLogger,
			}
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

// ── Tests ──────────────────────────────────────────────────────────────────

import { VerifyCallbackRoute } from './verify-callback-route'

describe('VerifyCallbackRoute', () => {
	let sut: VerifyCallbackRoute

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new VerifyCallbackRoute()
	})

	describe('loading()', () => {
		it('finalizes via completeFromCallback() with NO argument (session id comes from persisted storage)', async () => {
			const verifiedOutcome: CompleteOutcome = {
				kind: 'verified',
				status: {
					level: 'identityVerified',
					identity: {
						id: 'vi-1',
						accountRef: 'user-1',
						method: 'jpki',
						pocketSignUserId: 'ps-1',
						dedupeStrength: 'strong',
						status: 'active',
					},
				},
			}
			mockCompleteFromCallback.mockResolvedValueOnce(verifiedOutcome)

			await sut.loading()

			expect(mockCompleteFromCallback).toHaveBeenCalledTimes(1)
			expect(mockCompleteFromCallback).toHaveBeenCalledWith()
			expect(sut.outcome).toBe(verifiedOutcome)
			expect(sut.isSuccess).toBe(true)
			expect(sut.isPending).toBe(false)
			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})

		it('sets isSuccess=false and the sessionMismatch key when no session was in progress', async () => {
			const mismatch: CompleteOutcome = { kind: 'sessionMismatch' }
			mockCompleteFromCallback.mockResolvedValueOnce(mismatch)

			await sut.loading()

			expect(sut.isSuccess).toBe(false)
			expect(sut.errorKey).toBe('verifyCallback.error.sessionMismatch')
			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})

		it('maps UNAVAILABLE ConnectError to the correct i18n key', async () => {
			const unavailable = new ConnectError('unavailable', Code.Unavailable)
			mockCompleteFromCallback.mockResolvedValueOnce({
				kind: 'verificationFailed',
				error: unavailable,
			})

			await sut.loading()

			expect(sut.isSuccess).toBe(false)
			expect(sut.errorKey).toBe('verifyCallback.error.unavailable')
		})

		it('maps FAILED_PRECONDITION to the session-not-completed key', async () => {
			mockCompleteFromCallback.mockResolvedValueOnce({
				kind: 'verificationFailed',
				error: new ConnectError('not completed', Code.FailedPrecondition),
			})

			await sut.loading()

			expect(sut.errorKey).toBe('verifyCallback.error.notCompleted')
		})

		it('maps ALREADY_EXISTS to the already-verified key', async () => {
			mockCompleteFromCallback.mockResolvedValueOnce({
				kind: 'verificationFailed',
				error: new ConnectError('exists', Code.AlreadyExists),
			})

			await sut.loading()

			expect(sut.errorKey).toBe('verifyCallback.error.alreadyVerified')
		})

		it('maps PERMISSION_DENIED to the permissionDenied key (anti-replay / nonce-mismatch signal)', async () => {
			mockCompleteFromCallback.mockResolvedValueOnce({
				kind: 'verificationFailed',
				error: new ConnectError('nonce mismatch', Code.PermissionDenied),
			})

			await sut.loading()

			expect(sut.isSuccess).toBe(false)
			expect(sut.errorKey).toBe('verifyCallback.error.permissionDenied')
		})

		it('maps an unknown error to the generic key', async () => {
			mockCompleteFromCallback.mockResolvedValueOnce({
				kind: 'verificationFailed',
				error: new Error('something unexpected'),
			})

			await sut.loading()

			expect(sut.errorKey).toBe('verifyCallback.error.generic')
		})
	})

	describe('errorKey', () => {
		it('returns null while loading (outcome undefined)', () => {
			expect(sut.errorKey).toBeNull()
		})

		it('returns null when isSuccess (verified outcome)', async () => {
			mockCompleteFromCallback.mockResolvedValueOnce({
				kind: 'verified',
				status: { level: 'identityVerified' },
			})
			await sut.loading()

			expect(sut.errorKey).toBeNull()
		})
	})
})
