import { IRouter } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import type {
	CompleteOutcome,
	VerificationFailure,
} from '../../services/identity-verification-service'
import { IIdentityVerificationService } from '../../services/identity-verification-service'

/**
 * Callback route for the PocketSign Stamp redirect flow (identity-ekyc-jpki,
 * schema v0.60.0).
 *
 * The PocketSign app returns the fan here after the card read completes (or is
 * abandoned/fails). The callback URL carries NO query parameters — the backend
 * creates the session with callbackWithSessionId=false (per the official
 * PocketSign reference flow), so the session id is read from the service's own
 * persisted storage, not the URL. This route shows only a progress indicator
 * while `identityVerifications.create()` finalizes the Stamp session, hands the
 * outcome to Settings in app state, and opens `/settings` in place of itself
 * (historyStrategy: 'replace'). Settings shows the result: a reload here finds
 * the session id already cleared, so the result is not shown on this screen
 * (design "The verification result is shown on Settings").
 *
 * Route path: `verify/callback` (absolute: `/verify/callback`).
 * Registered in `app-shell.ts` WITHOUT `data: { auth: false }` — the fan is
 * authenticated when they return from the PocketSign app.
 */
export class VerifyCallbackRoute {
	private readonly identityVerifications = resolve(IIdentityVerificationService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('VerifyCallbackRoute')

	private abort: AbortController | null = null

	/**
	 * Fire-and-forget, so the progress indicator renders while Create runs; the
	 * router would otherwise hold the view until the network answers.
	 */
	public loading(): void {
		this.abort = new AbortController()
		void this.finish(this.abort.signal)
	}

	public unloading(): void {
		this.abort?.abort()
		this.abort = null
	}

	private async finish(signal: AbortSignal): Promise<void> {
		let failure: VerificationFailure | null
		try {
			const outcome = await this.identityVerifications.create(signal)
			if (signal.aborted) return
			failure = failureOf(outcome)
			if (failure === null) {
				this.logger.info('Verify callback: identity verified')
			} else {
				this.logger.warn('Verify callback: finalization failed', { outcome })
			}
		} catch (err) {
			// `create` throws only when no one is signed in, which the auth hook
			// rules out here; the fan still gets a reason to retry from.
			this.logger.error('Verify callback: could not finalize', { error: err })
			failure = 'generic'
		}
		this.identityVerifications.settle(failure)
		await this.router.load('/settings', { historyStrategy: 'replace' })
	}
}

/**
 * The reason Settings shows for a callback outcome, or `null` when the fan is
 * verified. Create's ConnectError codes:
 * - UNAVAILABLE: verification is not available right now.
 * - FAILED_PRECONDITION: session not yet completed, expired, or signature mismatch.
 * - ALREADY_EXISTS: the card already verified another account.
 * - PERMISSION_DENIED: session/nonce mismatch (backend anti-replay check).
 * Any other error is the generic, retryable reason.
 */
export function failureOf(
	outcome: CompleteOutcome,
): VerificationFailure | null {
	switch (outcome.kind) {
		case 'verified':
			return null
		case 'sessionMismatch':
			return 'sessionMismatch'
		case 'verificationFailed':
			if (!(outcome.error instanceof ConnectError)) return 'generic'
			switch (outcome.error.code) {
				case Code.Unavailable:
					return 'unavailable'
				case Code.FailedPrecondition:
					return 'notCompleted'
				case Code.AlreadyExists:
					return 'alreadyVerified'
				case Code.PermissionDenied:
					return 'permissionDenied'
				default:
					return 'generic'
			}
	}
}
