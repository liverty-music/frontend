import type { Params, RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteOutcome } from '../../services/identity-verification-service'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockRouter = { load: vi.fn(async () => {}) }
const mockI18n = { tr: vi.fn((key: string) => key) }

const mockCompleteFromCallback = vi.fn(
	async (_sessionId: string, _signal?: AbortSignal): Promise<CompleteOutcome> =>
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

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal RouteNode substitute with a URLSearchParams-backed
 * `queryParams` property — the only thing VerifyCallbackRoute reads.
 */
function makeRouteNode(params: Record<string, string> = {}): RouteNode {
	return {
		queryParams: new URLSearchParams(params),
	} as unknown as RouteNode
}

const noParams = makeRouteNode()
const withSessionId = makeRouteNode({ session_id: 'sess-abc' })
const mismatchedId = makeRouteNode({ session_id: 'sess-tampered' })

// ── Tests ──────────────────────────────────────────────────────────────────

import { VerifyCallbackRoute } from './verify-callback-route'

describe('VerifyCallbackRoute', () => {
	let sut: VerifyCallbackRoute

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new VerifyCallbackRoute()
	})

	describe('loading() — missing session_id param', () => {
		it('sets outcome to missingParam and navigates to Settings', async () => {
			await sut.loading({} as Params, noParams)

			expect(sut.outcome).toBe('missingParam')
			expect(sut.isSuccess).toBe(false)
			expect(mockCompleteFromCallback).not.toHaveBeenCalled()
			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})
	})

	describe('loading() — session present', () => {
		it('calls completeFromCallback with the query session_id', async () => {
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

			await sut.loading({} as Params, withSessionId)

			expect(mockCompleteFromCallback).toHaveBeenCalledWith('sess-abc')
			expect(sut.outcome).toBe(verifiedOutcome)
			expect(sut.isSuccess).toBe(true)
			expect(sut.isPending).toBe(false)
			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})

		it('sets isSuccess=false and errorKey on sessionMismatch', async () => {
			const mismatch: CompleteOutcome = { kind: 'sessionMismatch' }
			mockCompleteFromCallback.mockResolvedValueOnce(mismatch)

			await sut.loading({} as Params, mismatchedId)

			expect(sut.isSuccess).toBe(false)
			expect(sut.errorKey).toBe('verifyCallback.error.sessionMismatch')
			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})

		it('maps UNAVAILABLE ConnectError to the correct i18n key', async () => {
			const unavailable = new ConnectError('unavailable', Code.Unavailable)
			const failedOutcome: CompleteOutcome = {
				kind: 'verificationFailed',
				error: unavailable,
			}
			mockCompleteFromCallback.mockResolvedValueOnce(failedOutcome)

			await sut.loading({} as Params, withSessionId)

			expect(sut.isSuccess).toBe(false)
			expect(sut.errorKey).toBe('verifyCallback.error.unavailable')
		})

		it('maps FAILED_PRECONDITION to the session-not-completed key', async () => {
			const failedPrecondition = new ConnectError(
				'not completed',
				Code.FailedPrecondition,
			)
			const failedOutcome: CompleteOutcome = {
				kind: 'verificationFailed',
				error: failedPrecondition,
			}
			mockCompleteFromCallback.mockResolvedValueOnce(failedOutcome)

			await sut.loading({} as Params, withSessionId)

			expect(sut.errorKey).toBe('verifyCallback.error.notCompleted')
		})

		it('maps ALREADY_EXISTS to the already-verified key', async () => {
			const alreadyExists = new ConnectError('exists', Code.AlreadyExists)
			const failedOutcome: CompleteOutcome = {
				kind: 'verificationFailed',
				error: alreadyExists,
			}
			mockCompleteFromCallback.mockResolvedValueOnce(failedOutcome)

			await sut.loading({} as Params, withSessionId)

			expect(sut.errorKey).toBe('verifyCallback.error.alreadyVerified')
		})

		it('maps PERMISSION_DENIED to the permissionDenied key (anti-replay / nonce-mismatch signal)', async () => {
			const permissionDenied = new ConnectError(
				'nonce mismatch',
				Code.PermissionDenied,
			)
			const failedOutcome: CompleteOutcome = {
				kind: 'verificationFailed',
				error: permissionDenied,
			}
			mockCompleteFromCallback.mockResolvedValueOnce(failedOutcome)

			await sut.loading({} as Params, withSessionId)

			expect(sut.isSuccess).toBe(false)
			expect(sut.errorKey).toBe('verifyCallback.error.permissionDenied')
		})

		it('maps an unknown error to the generic key', async () => {
			const failedOutcome: CompleteOutcome = {
				kind: 'verificationFailed',
				error: new Error('something unexpected'),
			}
			mockCompleteFromCallback.mockResolvedValueOnce(failedOutcome)

			await sut.loading({} as Params, withSessionId)

			expect(sut.errorKey).toBe('verifyCallback.error.generic')
		})

		it('navigates to Settings with historyStrategy replace on success', async () => {
			const verifiedOutcome: CompleteOutcome = {
				kind: 'verified',
				status: { level: 'identityVerified' },
			}
			mockCompleteFromCallback.mockResolvedValueOnce(verifiedOutcome)

			await sut.loading({} as Params, withSessionId)

			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})
	})

	describe('errorKey', () => {
		it('returns null while loading (outcome undefined)', () => {
			expect(sut.errorKey).toBeNull()
		})

		it('returns null when isSuccess (verified outcome)', async () => {
			const verifiedOutcome: CompleteOutcome = {
				kind: 'verified',
				status: { level: 'identityVerified' },
			}
			mockCompleteFromCallback.mockResolvedValueOnce(verifiedOutcome)
			await sut.loading({} as Params, withSessionId)

			expect(sut.errorKey).toBeNull()
		})
	})
})
