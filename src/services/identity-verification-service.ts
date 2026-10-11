import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { IIdentityVerificationRpcClient } from '../adapter/rpc/client/identity-verification-client'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from '../adapter/storage/verify-session-storage'
import type {
	IdentityVerification,
	VerificationMethod,
} from '../entities/identity-verification'
import { IAuthService } from './auth-service'
import { SignedOut } from './events/signed-out'

export const IIdentityVerificationService =
	DI.createInterface<IIdentityVerificationService>(
		'IIdentityVerificationService',
		(x) => x.singleton(IdentityVerificationService),
	)

export interface IIdentityVerificationService
	extends IdentityVerificationService {}

/**
 * Terminal result of a `start()` orchestration, for the settings UI and the
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
 * Terminal result of a `create()` call, for the callback route
 * to display success/failure UI before navigating back to Settings.
 */
export type CompleteOutcome =
	// The session finalized successfully; the fan now has an Active
	// IdentityVerification.
	| {
			readonly kind: 'verified'
			readonly identityVerification: IdentityVerification | undefined
	  }
	// No verify session was in progress: nothing was persisted when the callback
	// ran (e.g. storage was cleared, or the callback URL was opened directly).
	| { readonly kind: 'sessionMismatch' }
	// The backend rejected the finalization (session not yet complete, expired,
	// signature mismatch, revoked certificate, or duplicate person id).
	| { readonly kind: 'verificationFailed'; readonly error: unknown }

/**
 * Fan-facing 本人確認 (identity verification) service (identity-ekyc-jpki,
 * PocketSign Stamp redirect flow). Its methods take the RPC's names (design D17
 * of unify-ticket-sales).
 *
 * This service drives the two-leg Stamp flow:
 *
 *   Leg 1 — `start()`:
 *     IdentityVerificationService.Start → persist session_id → navigate to
 *     redirectUrl (the browser opens the PocketSign app; the service returns immediately
 *     after initiating the navigation).
 *
 *   Leg 2 — `create()` (called by VerifyCallbackRoute):
 *     Read the session id from persisted storage →
 *     IdentityVerificationService.Create → update observable `current` →
 *     return CompleteOutcome for the UI.
 *
 * Every RPC acts for the signed-in caller; no request names the fan.
 * Registered as a `.singleton()` via `IIdentityVerificationService`, mirroring
 * the other stateful services (cf. `concert-store.ts`).
 */
export class IdentityVerificationService {
	private readonly logger = resolve(ILogger).scopeTo(
		'IdentityVerificationService',
	)
	private readonly rpcClient = resolve(IIdentityVerificationRpcClient)
	private readonly auth = resolve(IAuthService)

	/**
	 * The caller's IdentityVerification. `undefined` until first loaded, for a
	 * guest, and for a fan who never verified (check `loaded`). The settings UI
	 * binds to this; direct property mutation drives the DOM (no immutable
	 * replacement — Aurelia observes it directly).
	 */
	@observable public current: IdentityVerification | undefined = undefined

	/** True once `get` has resolved at least once. */
	public loaded = false

	constructor() {
		// Sign-out and account switch: forget the previous account's
		// IdentityVerification (design D15 of unify-ticket-sales).
		resolve(IEventAggregator).subscribe(SignedOut, () => this.clear())
	}

	/** Forget the loaded snapshot. Idempotent. */
	public clear(): void {
		this.current = undefined
		this.loaded = false
	}

	/**
	 * Load the caller's IdentityVerification (`IdentityVerificationService.Get`).
	 * Guests have no account to verify, so this resolves `undefined` without an
	 * RPC, as it does for a fan who never verified. Only an Active one verifies
	 * the fan (`isVerified`).
	 */
	public async get(
		signal?: AbortSignal,
	): Promise<IdentityVerification | undefined> {
		if (!this.auth.isAuthenticated) {
			// Guest: nothing to read. Present as unverified without an RPC.
			this.current = undefined
			this.loaded = true
			return undefined
		}
		const identityVerification = await this.rpcClient.get(signal)
		this.current = identityVerification
		this.loaded = true
		return identityVerification
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
	 * NOTE: the backend returns UNAVAILABLE for Start until PocketSign onboarding
	 * completes. The error propagates to the caller as a thrown ConnectError.
	 *
	 * TODO (identity-ekyc 5.3): when `method` is `driverLicence`, the 運転免許証
	 * fallback (Verify CardInfo) path uses a different Stamp method selector —
	 * no fallback UI is built yet (post-MVP); wire it here once available.
	 */
	public async start(
		method: VerificationMethod = 'jpki',
		signal?: AbortSignal,
	): Promise<VerifyOutcome> {
		if (!this.auth.isAuthenticated) {
			return { kind: 'notAuthenticated' }
		}

		this.logger.info('Starting Stamp verify session', { method })
		const { sessionId, redirectUrl } = await this.rpcClient.start(
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
	 * app returns the fan to `/verify/callback` (no query parameters — the backend
	 * sets callbackWithSessionId=false, per the official reference flow).
	 *
	 * Reads the session id from persisted storage (saved in leg 1 before the
	 * redirect), finalizes the session via `IdentityVerificationService.Create`,
	 * updates the observable `current`, clears the persisted session id, and returns a
	 * `CompleteOutcome` for the callback route to display.
	 *
	 * The persisted session id is always cleared regardless of outcome so the
	 * callback cannot be replayed by reloading the callback URL.
	 */
	public async create(signal?: AbortSignal): Promise<CompleteOutcome> {
		// The session id is read from OUR persisted storage, NOT from a callback
		// query parameter. The backend creates the Stamp session with
		// callbackWithSessionId=false (matching the official PocketSign reference
		// implementation, which carries the session id in a cookie), so the
		// callback URL has no `?session_id`. Reading our own persisted value also
		// means a third party cannot substitute a different session id via the URL.
		// Anti-replay / anti-redirect is enforced by the metadata nonce the backend
		// compares at FinalizeSession.
		const persistedSessionId = loadVerifySessionId()
		clearVerifySessionId()

		if (!persistedSessionId) {
			this.logger.warn('Verify callback: no persisted session id to finalize')
			return { kind: 'sessionMismatch' }
		}

		if (!this.auth.isAuthenticated) {
			throw new Error(
				'Cannot complete identity verification without a signed-in account',
			)
		}

		try {
			this.logger.info('Completing Stamp verification', {
				sessionId: persistedSessionId,
			})
			const identityVerification = await this.rpcClient.create(
				persistedSessionId,
				signal,
			)
			this.current = identityVerification
			this.loaded = true
			return { kind: 'verified', identityVerification }
		} catch (err) {
			this.logger.warn(
				'IdentityVerificationService.Create failed in callback',
				{
					sessionId: persistedSessionId,
					error: err,
				},
			)
			return { kind: 'verificationFailed', error: err }
		}
	}
}
