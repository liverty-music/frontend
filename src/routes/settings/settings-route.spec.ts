import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snack } from '../../../shared/ui/snack-bar/snack'
import type { IdentityVerification } from '../../entities/identity-verification'
import ja from '../../locales/ja/translation.json'
import type {
	VerificationFailure,
	VerifyOutcome,
} from '../../services/identity-verification-service'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// This spec covers ONLY the 本人確認 (identity verification) surface of
// SettingsRoute (identity-ekyc-jpki): startIdentityVerification() (the Stamp
// entry point), the verification-status display getters, and
// loadIdentityVerification(). The route
// resolves many other services; they are left as `{}` defaults (the resolve map
// returns `{}` for unmapped tokens), which is enough to construct the VM without
// exercising those unrelated paths.

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockAuth = {
	isAuthenticated: true,
	refreshEmailVerified: vi.fn(async () => {}),
}

// Mutable `current` so the getters can be exercised across states.
const mockIdentityVerifications = {
	current: undefined as IdentityVerification | undefined,
	start: vi.fn(async (): Promise<VerifyOutcome> => ({ kind: 'redirecting' })),
	get: vi.fn(async (): Promise<IdentityVerification | undefined> => undefined),
	// The callback's hand-off (design "The verification result is shown on
	// Settings"): the reason kept in the row, and a success to announce once.
	failure: null as VerificationFailure | null,
	takeVerifiedNotice: vi.fn(() => false),
}

const mockEa = { publish: vi.fn() }
const mockI18n = { tr: vi.fn((key: string) => key) }

const mockPush = { resolvePushState: vi.fn(async () => 'disabled') }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const tokenAny = token as { friendlyName?: string }
			const map: Record<string, unknown> = {
				IIdentityVerificationService: mockIdentityVerifications,
				IAuthService: mockAuth,
				IPushService: mockPush,
				ILogger: mockLogger,
				IEventAggregator: mockEa,
				I18N: mockI18n,
			}
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import { SettingsRoute } from './settings-route'

const activeIdentityVerification: IdentityVerification = {
	id: 'iv-1',
	userId: 'user-1',
	method: 'jpki',
	providerUserId: 'provider-1',
	dedupeStrength: 'strong',
	status: 'active',
}

describe('SettingsRoute — identity verification', () => {
	let sut: SettingsRoute

	beforeEach(() => {
		vi.clearAllMocks()
		mockIdentityVerifications.current = undefined
		mockIdentityVerifications.failure = null
		mockIdentityVerifications.takeVerifiedNotice.mockReturnValue(false)
		mockAuth.isAuthenticated = true
		mockIdentityVerifications.start.mockResolvedValue({ kind: 'redirecting' })
		sut = new SettingsRoute()
	})

	describe('startIdentityVerification() — Stamp entry point', () => {
		it('calls identityVerifications.start("jpki") and handles the redirecting outcome without throwing', async () => {
			await expect(sut.startIdentityVerification()).resolves.toBeUndefined()
			expect(mockIdentityVerifications.start).toHaveBeenCalledWith('jpki')
		})

		it('handles the notAuthenticated outcome without throwing', async () => {
			mockIdentityVerifications.start.mockResolvedValueOnce({
				kind: 'notAuthenticated',
			})
			await expect(sut.startIdentityVerification()).resolves.toBeUndefined()
			expect(mockIdentityVerifications.start).toHaveBeenCalledWith('jpki')
		})
	})

	describe('loadIdentityVerification() (via loading())', () => {
		/** Let the fire-and-forget loads settle without awaiting loading() itself. */
		const flush = () => new Promise((r) => setTimeout(r, 0))

		it('starts the status load when authenticated', async () => {
			mockAuth.isAuthenticated = true
			sut.loading()
			await flush()
			expect(mockIdentityVerifications.get).toHaveBeenCalledTimes(1)
		})

		it('does NOT reach the backend for a guest (unauthenticated)', async () => {
			mockAuth.isAuthenticated = false
			sut.loading()
			await flush()
			expect(mockIdentityVerifications.get).not.toHaveBeenCalled()
		})

		it('does not block the view swap on the RPC', () => {
			mockAuth.isAuthenticated = true
			// Never resolves: if loading() awaited it, the router would hold the
			// outgoing screen for as long as the network took. Returning void is the
			// contract — Settings is a bottom-nav tab like the others.
			mockIdentityVerifications.get.mockReturnValueOnce(new Promise(() => {}))

			expect(sut.loading()).toBeUndefined()
		})

		it('is non-fatal — a get failure is swallowed', async () => {
			mockAuth.isAuthenticated = true
			mockIdentityVerifications.get.mockRejectedValueOnce(
				new Error('UNAVAILABLE'),
			)

			expect(() => sut.loading()).not.toThrow()
			// The rejection is handled inside the load routine, so nothing escapes to
			// become an unhandled rejection once it settles.
			await flush()
		})
	})

	describe('verification status display getters', () => {
		it('isVerified is true only for an Active IdentityVerification', () => {
			mockIdentityVerifications.current = undefined
			expect(sut.isVerified).toBe(false)

			mockIdentityVerifications.current = {
				...activeIdentityVerification,
				status: 'needsReverification',
			}
			expect(sut.isVerified).toBe(false)

			mockIdentityVerifications.current = activeIdentityVerification
			expect(sut.isVerified).toBe(true)
		})

		it('method / dedupe keys are null until verified, then derive from the IdentityVerification', () => {
			mockIdentityVerifications.current = undefined
			expect(sut.verificationMethodKey).toBeNull()
			expect(sut.dedupeStrengthKey).toBeNull()

			mockIdentityVerifications.current = activeIdentityVerification
			expect(sut.verificationMethodKey).toBe(
				'settings.identityVerification.methodJpki',
			)
			expect(sut.dedupeStrengthKey).toBe(
				'settings.identityVerification.dedupeStrong',
			)
		})
	})

	describe('the result of returning from the PocketSign app', () => {
		const SPEC = 'components/infrastructure/fan/web/route/settings'
		const published = () => mockEa.publish.mock.calls.map(([e]) => e as Snack)

		afterEach(() => {
			sut.detaching()
			vi.useRealTimers()
		})

		it(`@spec ${SPEC} "Verification succeeds"`, () => {
			mockIdentityVerifications.current = activeIdentityVerification
			mockIdentityVerifications.takeVerifiedNotice.mockReturnValueOnce(true)

			sut.attached()

			expect(published().map((snack) => snack.message)).toEqual([
				'verifyCallback.success.heading',
			])
			expect(ja.verifyCallback.success.heading).toBe('本人確認が完了しました')
			expect(sut.isVerified).toBe(true)
			expect(sut.canStartIdentityVerification).toBe(false)
			expect(sut.identityFailureKey).toBeNull()
		})

		it(`@spec ${SPEC} "Card read not finished"`, () => {
			vi.useFakeTimers()
			mockIdentityVerifications.failure = 'notCompleted'

			sut.attached()
			vi.advanceTimersByTime(10_000)

			expect(sut.identityFailureKey).toBe('verifyCallback.error.notCompleted')
			expect(ja.verifyCallback.error.notCompleted).toBe(
				'カードの読み取りが終わっていないか、期限が切れました。もう一度お試しください。',
			)
			expect(sut.canStartIdentityVerification).toBe(true)
			expect(published()).toEqual([])
		})

		it(`@spec ${SPEC} "Card already used by another account"`, () => {
			mockIdentityVerifications.failure = 'alreadyVerified'

			expect(sut.identityFailureKey).toBe(
				'verifyCallback.error.alreadyVerified',
			)
			expect(sut.identityFailureNeedsSupport).toBe(true)
			expect(sut.supportEmail).toBe('pannpers@pannpers.dev')
			expect(sut.canStartIdentityVerification).toBe(false)
		})

		it(`@spec ${SPEC} "Verification unavailable"`, () => {
			mockIdentityVerifications.failure = 'unavailable'

			expect(sut.identityFailureKey).toBe('verifyCallback.error.unavailable')
			expect(ja.verifyCallback.error.unavailable).toBe(
				'本人確認は現在ご利用いただけません。時間をおいてお試しください。',
			)
			expect(sut.identityFailureNeedsSupport).toBe(false)
			expect(sut.canStartIdentityVerification).toBe(true)
		})

		it(`@spec ${SPEC} "Callback opened again after success"`, () => {
			// Reopening finds no session on the device, but the fan is verified.
			mockIdentityVerifications.failure = 'sessionMismatch'
			mockIdentityVerifications.current = activeIdentityVerification

			sut.attached()

			expect(sut.isVerified).toBe(true)
			expect(sut.identityFailureKey).toBeNull()
			expect(published()).toEqual([])
		})

		it(`@spec ${SPEC} "No verification on this device"`, () => {
			mockIdentityVerifications.failure = 'sessionMismatch'

			expect(sut.identityFailureKey).toBe(
				'verifyCallback.error.sessionMismatch',
			)
			expect(ja.verifyCallback.error.sessionMismatch).toBe(
				'本人確認の手続きが見つかりませんでした。設定画面からもう一度お試しください。',
			)
			expect(sut.canStartIdentityVerification).toBe(true)
		})
	})
})
