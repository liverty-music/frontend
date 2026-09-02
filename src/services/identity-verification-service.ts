import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	IPocketSignVerifyClient,
	PocketSignUnavailableError,
} from '../adapter/pocket-sign/pocket-sign-verify-client'
import { IIdentityVerificationRpcClient } from '../adapter/rpc/client/identity-verification-client'
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

/** Terminal result of a `verify()` orchestration, for the UI to branch on. */
export type VerifyOutcome =
	// The Pocket Sign Verify SDK is not integrated yet (Section 0) — show the
	// friendly "coming soon" state rather than a broken flow.
	| { readonly kind: 'vendorUnavailable' }
	// The full challenge–response completed and the account is now verified.
	| { readonly kind: 'verified'; readonly status: MyVerificationStatus }
	// A guest (no authenticated account) cannot verify.
	| { readonly kind: 'notAuthenticated' }

/**
 * Fan-facing identity-verification service (identity-ekyc-jpki, task 5.1).
 *
 * Orchestrates the account verification lane: it reads the caller's current
 * verification status over RPC and drives the Pocket Sign challenge–response
 * (StartVerify → SDK card-read → CompleteVerify). It owns the observable
 * `status` the settings UI binds to, and re-exports `verifyAvailable` so the UI
 * can render the "verification coming soon" state while the vendor SDK is
 * pending onboarding.
 *
 * Registered as a `.singleton()` via `IIdentityVerificationService`, mirroring
 * the other stateful services (cf. `concert-store.ts`).
 */
export class IdentityVerificationService {
	private readonly logger = resolve(ILogger).scopeTo(
		'IdentityVerificationService',
	)
	private readonly rpcClient = resolve(IIdentityVerificationRpcClient)
	private readonly pocketSign = resolve(IPocketSignVerifyClient)
	private readonly auth = resolve(IAuthService)
	private readonly userStore = resolve(IUserStore)

	/**
	 * The caller's verification snapshot. `undefined` until first loaded. The
	 * settings UI binds to this and to the derived getters below; direct property
	 * mutation drives the DOM (no immutable replacement — Aurelia observes it).
	 */
	@observable public status: MyVerificationStatus | undefined = undefined

	/** True once `getMyVerificationStatus` has resolved at least once. */
	public loaded = false

	/**
	 * Whether the real Pocket Sign Verify SDK card-read is available. `false`
	 * while the vendor seam is the stub (pre-onboarding), so the UI shows the
	 * "coming soon" affordance instead of starting an un-completable flow.
	 */
	public get verifyAvailable(): boolean {
		return this.pocketSign.isAvailable
	}

	/**
	 * Load the caller's verification status. Guests have no account to verify, so
	 * this returns an `unverified` snapshot without an RPC. On the authenticated
	 * path only `getMyVerificationStatus` reaches the backend (StartVerify /
	 * CompleteVerify are backend-stubbed → UNAVAILABLE today).
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
	 * Open a verification attempt for the given method. Returns the challenge
	 * (Nonce) the Pocket Sign Verify SDK signs against the card, plus the session
	 * id to pass back to `completeVerify`.
	 *
	 * NOTE: backend-stubbed → currently rejects with UNAVAILABLE; the full flow
	 * is exercised end-to-end only after Pocket Sign onboarding (Section 0).
	 */
	public async startVerify(
		method: VerificationMethod,
		signal?: AbortSignal,
	): Promise<{ sessionId: string; challenge: Uint8Array }> {
		const userId = this.requireUserId()
		return this.rpcClient.startVerify(userId, method, signal)
	}

	/**
	 * Submit the SDK-signed response for validation. On success the account
	 * becomes IDENTITY_VERIFIED; the returned snapshot is also written to the
	 * observable `status` so the UI updates in place.
	 *
	 * NOTE: backend-stubbed → currently rejects with UNAVAILABLE.
	 */
	public async completeVerify(
		sessionId: string,
		signedResponse: Uint8Array,
		signal?: AbortSignal,
	): Promise<MyVerificationStatus> {
		const userId = this.requireUserId()
		const status = await this.rpcClient.completeVerify(
			userId,
			sessionId,
			signedResponse,
			signal,
		)
		this.status = status
		this.loaded = true
		return status
	}

	/**
	 * End-to-end verification convenience for the "verify identity" button:
	 * StartVerify → Pocket Sign SDK card-read → CompleteVerify. While the vendor
	 * SDK is the pre-onboarding stub this short-circuits to `vendorUnavailable`
	 * (no RPC, no broken flow); the UI renders the "coming soon" message.
	 *
	 * TODO (identity-ekyc 5.3): when `method` is `driverLicence`, this is the
	 * 運転免許証 fallback (Verify CardInfo) path — the SDK read differs and the
	 * resulting account is flagged weaker-dedupe. No fallback UI is built yet
	 * (needs the SDK); wire it here once available.
	 */
	public async verify(
		method: VerificationMethod = 'jpki',
		signal?: AbortSignal,
	): Promise<VerifyOutcome> {
		if (!this.currentUserId()) {
			return { kind: 'notAuthenticated' }
		}
		if (!this.pocketSign.isAvailable) {
			// TODO: integrate Pocket Sign Verify SDK card-read after onboarding
			// (identity-ekyc-jpki Section 0). Until then the card read cannot run,
			// so surface the "coming soon" state instead of calling StartVerify.
			this.logger.info('Verify requested but Pocket Sign SDK is unavailable')
			return { kind: 'vendorUnavailable' }
		}

		try {
			const { sessionId, challenge } = await this.startVerify(method, signal)
			const signedResponse = await this.pocketSign.readCard(method, challenge)
			const status = await this.completeVerify(
				sessionId,
				signedResponse,
				signal,
			)
			return { kind: 'verified', status }
		} catch (err) {
			if (err instanceof PocketSignUnavailableError) {
				// The stub (or a future unusable runtime) rejected the card read.
				return { kind: 'vendorUnavailable' }
			}
			throw err
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
				'Cannot verify identity without an authenticated user account',
			)
		}
		return userId
	}
}
