import { DI, ILogger, observable, resolve } from 'aurelia'
import { IIdentityVerificationRpcClient } from '../adapter/rpc/client/identity-verification-client'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from '../adapter/storage/verify-session-storage'
import type {
	MyVerificationStatus,
	VerificationMethod,
} from '../entities/verified-identity'
import { IAuthService } from './auth-service'
import { IUserStore } from './user-store'

export const IIdentityVerificationService =
	DI.createInterface<IIdentityVerificationService>(
		'IIdentityVerificationService',
		(x) => x.singleton(IdentityVerificationService),
	)

export interface IIdentityVerificationService
	extends IdentityVerificationService {}

/**
 * Terminal result of a `verify()` orchestration, for the settings UI and the
 * verify-callback route to branch on.
 */
export type VerifyOutcome =
	// The full Stamp redirect was initiated; the browser is about to navigate
	// to the PocketSign app. The caller should not expect a return value — the
	// browser navigates away.
	| { readonly kind: 'redirecting' }
	// A guest (no authenticated account) cannot verify.
	| { readonly kind: 'notAuthenticated' }

/**
 * Terminal result of a `completeFromCallback()` call, for the callback route
 * to display success/failure UI before navigating back to Settings.
 */
export type CompleteOutcome =
	// The session finalized successfully; the account is now IDENTITY_VERIFIED.
	| { readonly kind: 'verified'; readonly status: MyVerificationStatus }
	// The session_id in the callback did not match the persisted one (stale,
	// replayed, or tampered).
	| { readonly kind: 'sessionMismatch' }
	// The backend rejected the finalization (session not yet complete, expired,
	// signature mismatch, revoked certificate, or duplicate person id).
	| { readonly kind: 'verificationFailed'; readonly error: unknown }

/**
 * Fan-facing identity-verification service (identity-ekyc-jpki, PocketSign
 * Stamp redirect flow — schema v0.60.0).
 *
 * This service drives the two-leg Stamp flow:
 *
 *   Leg 1 — `verify()`:
 *     StartVerify RPC → persist session_id → navigate to redirectUrl
 *     (the browser opens the PocketSign app; the service returns immediately
 *     after initiating the navigation).
 *
 *   Leg 2 — `completeFromCallback(session_id)` (called by VerifyCallbackRoute):
 *     Validate session_id against the persisted value → CompleteVerify RPC →
 *     update observable `status` → return CompleteOutcome for the UI.
 *
 * Registered as a `.singleton()` via `IIdentityVerificationService`, mirroring
 * the other stateful services (cf. `concert-store.ts`).
 */
export class IdentityVerificationService {
	private readonly logger = resolve(ILogger).scopeTo(
		'IdentityVerificationService',
	)
	private readonly rpcClient = resolve(IIdentityVerificationRpcClient)
	private readonly auth = resolve(IAuthService)
	private readonly userStore = resolve(IUserStore)

	/**
	 * The caller's verification snapshot. `undefined` until first loaded. The
	 * settings UI binds to this; direct property mutation drives the DOM (no
	 * immutable replacement — Aurelia observes it directly).
	 */
	@observable public status: MyVerificationStatus | undefined = undefined

	/** True once `getMyVerificationStatus` has resolved at least once. */
	public loaded = false

	/**
	 * Load the caller's verification status. Guests have no account to verify,
	 * so this returns an `unverified` snapshot without an RPC. On the
	 * authenticated path only `getMyVerificationStatus` reaches the backend.
	 */
	public async getMyVerificationStatus(
		signal?: AbortSignal,
	): Promise<MyVerificationStatus> {
		const userId = this.currentUserId()
		if (!userId) {
			// Guest: nothing to read. Present as unverified without an RPC.
			this.status = { level: 'unverified' }
			this.loaded = true
			return this.status
		}
		const status = await this.rpcClient.getMyVerificationStatus(userId, signal)
		this.status = status
		this.loaded = true
		return status
	}

	/**
	 * Leg 1 of the Stamp flow: open a Stamp session, persist the session_id for
	 * the callback leg, and navigate the browser to the PocketSign app via the
	 * returned redirect URL.
	 *
	 * The method intentionally performs `window.location.href = redirectUrl` as
	 * its last step — the browser navigates away and the function does not return
	 * a meaningful value to its caller after that assignment. The caller (settings
	 * route) should treat the returned `{ kind: 'redirecting' }` as a terminal
	 * signal.
	 *
	 * NOTE: the backend returns UNAVAILABLE for StartVerify until PocketSign
	 * onboarding (Section 0) completes. The error propagates to the caller as a
	 * thrown ConnectError, which the settings route routes via IConnectErrorRouter.
	 *
	 * TODO (identity-ekyc 5.3): when `method` is `driverLicence`, the 運転免許証
	 * fallback (Verify CardInfo) path uses a different Stamp method selector —
	 * no fallback UI is built yet (post-MVP); wire it here once available.
	 */
	public async verify(
		method: VerificationMethod = 'jpki',
		signal?: AbortSignal,
	): Promise<VerifyOutcome> {
		const userId = this.currentUserId()
		if (!userId) {
			return { kind: 'notAuthenticated' }
		}

		this.logger.info('Starting Stamp verify session', { method })
		const { sessionId, redirectUrl } = await this.rpcClient.startVerify(
			userId,
			method,
			signal,
		)

		// Persist before navigating away — if the write fails (private Safari,
		// sandboxed iframe) the callback will detect the mismatch and show an
		// error rather than silently completing with an un-validated session.
		saveVerifySessionId(sessionId)

		this.logger.info('Redirecting to PocketSign app', { sessionId })
		window.location.href = redirectUrl

		return { kind: 'redirecting' }
	}

	/**
	 * Leg 2 of the Stamp flow: called by VerifyCallbackRoute when the PocketSign
	 * app returns the fan to `/verify/callback?session_id=<id>`.
	 *
	 * Validates the `session_id` from the URL against the persisted value (the
	 * anti-replay check the client performs before even calling the backend),
	 * finalizes the session via CompleteVerify, updates the observable `status`,
	 * clears the persisted session id, and returns a `CompleteOutcome` for the
	 * callback route to display.
	 *
	 * The persisted session id is always cleared regardless of outcome so the
	 * callback cannot be replayed by reloading the callback URL.
	 */
	public async completeFromCallback(
		callbackSessionId: string,
		signal?: AbortSignal,
	): Promise<CompleteOutcome> {
		const persistedSessionId = loadVerifySessionId()
		clearVerifySessionId()

		if (!persistedSessionId || persistedSessionId !== callbackSessionId) {
			this.logger.warn('Verify callback session_id mismatch', {
				callbackSessionId,
				hasPersisted: !!persistedSessionId,
			})
			return { kind: 'sessionMismatch' }
		}

		const userId = this.requireUserId()

		try {
			this.logger.info('Completing Stamp verification', {
				sessionId: callbackSessionId,
			})
			const status = await this.rpcClient.completeVerify(
				userId,
				callbackSessionId,
				signal,
			)
			this.status = status
			this.loaded = true
			return { kind: 'verified', status }
		} catch (err) {
			this.logger.warn('CompleteVerify failed in callback', {
				sessionId: callbackSessionId,
				error: err,
			})
			return { kind: 'verificationFailed', error: err }
		}
	}

	private currentUserId(): string | undefined {
		if (!this.auth.isAuthenticated) return undefined
		return this.userStore.current?.id
	}

	private requireUserId(): string {
		const userId = this.currentUserId()
		if (!userId) {
			throw new Error(
				'Cannot complete identity verification without an authenticated user account',
			)
		}
		return userId
	}
}
