import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { IKycRpcClient } from '../adapter/rpc/client/kyc-client'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from '../adapter/storage/verify-session-storage'
import {
	type KycStatus,
	type VerificationMethod,
	verificationLevelOf,
} from '../entities/kyc'
import { IAuthService } from './auth-service'
import { SignedOut } from './events/signed-out'

export const IKycService = DI.createInterface<IKycService>('IKycService', (x) =>
	x.singleton(KycService),
)

export interface IKycService extends KycService {}

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
	// The session finalized successfully; the account is now KYC_VERIFIED.
	| { readonly kind: 'verified'; readonly status: KycStatus }
	// No verify session was in progress: nothing was persisted when the callback
	// ran (e.g. storage was cleared, or the callback URL was opened directly).
	| { readonly kind: 'sessionMismatch' }
	// The backend rejected the finalization (session not yet complete, expired,
	// signature mismatch, revoked certificate, or duplicate person id).
	| { readonly kind: 'verificationFailed'; readonly error: unknown }

/**
 * Fan-facing 本人確認 (KYC) service (identity-ekyc-jpki, PocketSign Stamp
 * redirect flow).
 *
 * This service drives the two-leg Stamp flow:
 *
 *   Leg 1 — `verify()`:
 *     KycService.Start → persist session_id → navigate to redirectUrl
 *     (the browser opens the PocketSign app; the service returns immediately
 *     after initiating the navigation).
 *
 *   Leg 2 — `completeFromCallback()` (called by VerifyCallbackRoute):
 *     Read the session id from persisted storage → KycService.Create →
 *     update observable `status` → return CompleteOutcome for the UI.
 *
 * Every RPC acts for the signed-in caller; no request names the fan.
 * Registered as a `.singleton()` via `IKycService`, mirroring the other
 * stateful services (cf. `concert-store.ts`).
 */
export class KycService {
	private readonly logger = resolve(ILogger).scopeTo('KycService')
	private readonly rpcClient = resolve(IKycRpcClient)
	private readonly auth = resolve(IAuthService)

	/**
	 * The caller's 本人確認 snapshot. `undefined` until first loaded. The
	 * settings UI binds to this; direct property mutation drives the DOM (no
	 * immutable replacement — Aurelia observes it directly).
	 */
	@observable public status: KycStatus | undefined = undefined

	/** True once `getStatus` has resolved at least once. */
	public loaded = false

	constructor() {
		// Sign-out and account switch: forget the previous account's Kyc
		// (design D15 of unify-ticket-sales).
		resolve(IEventAggregator).subscribe(SignedOut, () => this.clear())
	}

	/** Forget the loaded snapshot. Idempotent. */
	public clear(): void {
		this.status = undefined
		this.loaded = false
	}

	/**
	 * Load the caller's 本人確認 snapshot. Guests have no account to verify, so
	 * this returns an `unverified` snapshot without an RPC. For a signed-in fan
	 * it reads the Kyc (`KycService.Get`); the level follows from it, as the
	 * backend derives it (an Active Kyc backs a KYC_VERIFIED account).
	 */
	public async getStatus(signal?: AbortSignal): Promise<KycStatus> {
		if (!this.auth.isAuthenticated) {
			// Guest: nothing to read. Present as unverified without an RPC.
			this.status = { level: 'unverified' }
			this.loaded = true
			return this.status
		}
		const kyc = await this.rpcClient.get(signal)
		const status: KycStatus = kyc
			? { level: verificationLevelOf(kyc), kyc }
			: { level: 'unverified' }
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
	 * NOTE: the backend returns UNAVAILABLE for Start until PocketSign onboarding
	 * completes. The error propagates to the caller as a thrown ConnectError.
	 *
	 * TODO (identity-ekyc 5.3): when `method` is `driverLicence`, the 運転免許証
	 * fallback (Verify CardInfo) path uses a different Stamp method selector —
	 * no fallback UI is built yet (post-MVP); wire it here once available.
	 */
	public async verify(
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
	 * redirect), finalizes the session via `KycService.Create`, updates the
	 * observable `status`, clears the persisted session id, and returns a
	 * `CompleteOutcome` for the callback route to display.
	 *
	 * The persisted session id is always cleared regardless of outcome so the
	 * callback cannot be replayed by reloading the callback URL.
	 */
	public async completeFromCallback(
		signal?: AbortSignal,
	): Promise<CompleteOutcome> {
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
			throw new Error('Cannot complete KYC without a signed-in account')
		}

		try {
			this.logger.info('Completing Stamp verification', {
				sessionId: persistedSessionId,
			})
			const status = await this.rpcClient.create(persistedSessionId, signal)
			this.status = status
			this.loaded = true
			return { kind: 'verified', status }
		} catch (err) {
			this.logger.warn('KycService.Create failed in callback', {
				sessionId: persistedSessionId,
				error: err,
			})
			return { kind: 'verificationFailed', error: err }
		}
	}
}
