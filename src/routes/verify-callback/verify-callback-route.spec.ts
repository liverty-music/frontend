import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteOutcome } from '../../services/identity-verification-service'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockRouter = { load: vi.fn(async () => {}) }

// create takes NO session id argument: the service reads it from
// its own persisted storage (callbackWithSessionId=false → no query param).
const mockCreate = vi.fn(
	async (_signal?: AbortSignal): Promise<CompleteOutcome> =>
		({ kind: 'sessionMismatch' }) as CompleteOutcome,
)
const mockSettle = vi.fn()

const mockIdentityVerificationService = {
	create: mockCreate,
	settle: mockSettle,
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const map: Record<string, unknown> = {
				IIdentityVerificationService: mockIdentityVerificationService,
				IRouter: mockRouter,
				ILogger: mockLogger,
			}
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

// ── Tests ──────────────────────────────────────────────────────────────────

import { failureOf, VerifyCallbackRoute } from './verify-callback-route'

const verified: CompleteOutcome = {
	kind: 'verified',
	identityVerification: {
		id: 'iv-1',
		userId: 'user-1',
		method: 'jpki',
		providerUserId: 'p-1',
		dedupeStrength: 'strong',
		status: 'active',
		verifyTime: undefined,
	},
}

const failed = (code: Code): CompleteOutcome => ({
	kind: 'verificationFailed',
	error: new ConnectError('rejected', code),
})

/** Run loading() and wait for the fire-and-forget finalization to settle. */
async function runCallback(sut: VerifyCallbackRoute): Promise<void> {
	sut.loading()
	await vi.waitFor(() => expect(mockRouter.load).toHaveBeenCalled())
}

describe('VerifyCallbackRoute', () => {
	let sut: VerifyCallbackRoute

	beforeEach(() => {
		vi.clearAllMocks()
		sut = new VerifyCallbackRoute()
	})

	describe('loading()', () => {
		it('does not hold the view on Create, so the progress indicator renders', () => {
			let answer: (o: CompleteOutcome) => void = () => {}
			mockCreate.mockReturnValueOnce(
				new Promise((resolve) => {
					answer = resolve
				}),
			)

			expect(sut.loading()).toBeUndefined()
			expect(mockCreate).toHaveBeenCalledOnce()
			expect(mockRouter.load).not.toHaveBeenCalled()
			answer(verified)
		})

		it('finalizes via create() with only an abort signal (the session id comes from persisted storage)', async () => {
			mockCreate.mockResolvedValueOnce(verified)

			await runCallback(sut)

			expect(mockCreate).toHaveBeenCalledWith(expect.any(AbortSignal))
		})

		it('hands a success to Settings and opens it in place of the callback', async () => {
			mockCreate.mockResolvedValueOnce(verified)

			await runCallback(sut)

			expect(mockSettle).toHaveBeenCalledWith(null)
			expect(mockRouter.load).toHaveBeenCalledWith('/settings', {
				historyStrategy: 'replace',
			})
		})

		it('hands the failure reason to Settings before opening it', async () => {
			mockCreate.mockResolvedValueOnce(failed(Code.FailedPrecondition))

			await runCallback(sut)

			expect(mockSettle).toHaveBeenCalledWith('notCompleted')
			expect(mockSettle.mock.invocationCallOrder[0]).toBeLessThan(
				mockRouter.load.mock.invocationCallOrder[0],
			)
		})

		it('hands the generic reason to Settings when create() throws', async () => {
			mockCreate.mockRejectedValueOnce(new Error('not signed in'))

			await runCallback(sut)

			expect(mockSettle).toHaveBeenCalledWith('generic')
		})

		it('leaves the outcome alone when the fan left the callback first', async () => {
			let answer: (o: CompleteOutcome) => void = () => {}
			mockCreate.mockReturnValueOnce(
				new Promise((resolve) => {
					answer = resolve
				}),
			)

			sut.loading()
			sut.unloading()
			answer(verified)
			await Promise.resolve()
			await Promise.resolve()

			expect(mockSettle).not.toHaveBeenCalled()
			expect(mockRouter.load).not.toHaveBeenCalled()
		})
	})
})

describe('failureOf', () => {
	it('is null when the fan is verified', () => {
		expect(failureOf(verified)).toBeNull()
	})

	it('names a missing session on this device', () => {
		expect(failureOf({ kind: 'sessionMismatch' })).toBe('sessionMismatch')
	})

	it.each([
		[Code.Unavailable, 'unavailable'],
		[Code.FailedPrecondition, 'notCompleted'],
		[Code.AlreadyExists, 'alreadyVerified'],
		[Code.PermissionDenied, 'permissionDenied'],
		[Code.Internal, 'generic'],
	])('maps Create %s to %s', (code, reason) => {
		expect(failureOf(failed(code))).toBe(reason)
	})

	it('maps an error that is not a ConnectError to generic', () => {
		expect(
			failureOf({ kind: 'verificationFailed', error: new Error('boom') }),
		).toBe('generic')
	})
})
