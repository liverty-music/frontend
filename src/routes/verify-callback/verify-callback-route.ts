import { I18N } from '@aurelia/i18n'
import type { Params, RouteNode } from '@aurelia/router'
import { IRouter } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import type { CompleteOutcome } from '../../services/identity-verification-service'
import { IIdentityVerificationService } from '../../services/identity-verification-service'

/**
 * Callback route for the PocketSign Stamp redirect flow (identity-ekyc-jpki,
 * schema v0.60.0).
 *
 * The PocketSign app returns the fan here after the card read completes (or is
 * abandoned/fails). The URL carries a `session_id` query parameter. This route:
 *   1. Reads `session_id` from the query string in the router `loading()` hook.
 *   2. Calls `identityService.completeFromCallback(session_id)`.
 *   3. Shows a brief success or failure message.
 *   4. Navigates back to `/settings` automatically (historyStrategy: 'replace'
 *      so the callback URL is not in the back-stack).
 *
 * Route path: `verify/callback` (absolute: `/verify/callback`).
 * Registered in `app-shell.ts` WITHOUT `data: { auth: false }` — the fan is
 * authenticated when they return from the PocketSign app.
 *
 * Error taxonomy (ConnectError codes from CompleteVerify):
 * - UNAVAILABLE: backend PocketSign service not yet configured (Section 0 stub).
 * - FAILED_PRECONDITION: session not yet completed, expired, or signature mismatch.
 * - ALREADY_EXISTS: person already has an IDENTITY_VERIFIED account.
 * - PERMISSION_DENIED: session/nonce mismatch (backend anti-replay check).
 */
export class VerifyCallbackRoute {
	private readonly identity = resolve(IIdentityVerificationService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('VerifyCallbackRoute')

	// Unused at runtime but needed so the template can reference `i18n` for
	// the `t="..."` binding. Aurelia's template compiler reads from the resolve
	// result, not from a `resolve()` call site.
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: held for DI side-effect
	private readonly _i18n = resolve(I18N)

	/**
	 * Whether the CompleteVerify RPC is in flight. Drives the loading spinner in
	 * the template. Named `isPending` (not `loading`) to avoid clashing with the
	 * Aurelia router lifecycle hook of the same name.
	 */
	public isPending = true

	/**
	 * The UI state to render. `undefined` while the RPC is in flight; set to the
	 * outcome once `completeFromCallback` resolves.
	 */
	public outcome: CompleteOutcome | 'missingParam' | undefined = undefined

	/** Human-readable error i18n key for the template. `null` on success. */
	public get errorKey(): string | null {
		if (!this.outcome) return null
		if (this.outcome === 'missingParam')
			return 'verifyCallback.error.missingParam'
		if (this.outcome.kind === 'sessionMismatch') {
			return 'verifyCallback.error.sessionMismatch'
		}
		if (this.outcome.kind === 'verificationFailed') {
			return this.connectErrorKey(this.outcome.error)
		}
		return null
	}

	/** Whether verification succeeded. */
	public get isSuccess(): boolean {
		return (
			this.outcome !== undefined &&
			this.outcome !== 'missingParam' &&
			this.outcome.kind === 'verified'
		)
	}

	/**
	 * Aurelia router lifecycle hook — runs before the component activates.
	 * Reads `session_id` from the query params and finalizes the Stamp session.
	 *
	 * The router awaits this hook before mounting the view, so `isPending` is
	 * `false` when the template first renders. The template therefore does not
	 * need to handle a mid-render loading → done transition; the view is
	 * mounted only after the outcome is known. `isPending` is kept for forward
	 * compatibility if the hook is ever made non-blocking.
	 */
	public async loading(_params: Params, next: RouteNode): Promise<void> {
		this.isPending = true
		this.outcome = undefined

		const sessionId = next.queryParams.get('session_id')

		if (!sessionId) {
			this.logger.warn('Verify callback arrived without session_id param')
			this.outcome = 'missingParam'
			this.isPending = false
			await this.navigateToSettings()
			return
		}

		this.logger.info('Verify callback: finalizing Stamp session', { sessionId })
		const outcome = await this.identity.completeFromCallback(sessionId)
		this.outcome = outcome
		this.isPending = false

		if (outcome.kind === 'verified') {
			this.logger.info('Verify callback: identity verified successfully')
		} else {
			this.logger.warn('Verify callback: finalization failed', { outcome })
		}

		await this.navigateToSettings()
	}

	/** Navigate to Settings, replacing the callback URL in the history stack. */
	private async navigateToSettings(): Promise<void> {
		await this.router.load('/settings', { historyStrategy: 'replace' })
	}

	/**
	 * Map a ConnectError (or any unknown error) from CompleteVerify to an i18n
	 * key. Falls back to the generic key for unrecognized errors so the UI always
	 * shows something actionable rather than a bare error object.
	 */
	private connectErrorKey(err: unknown): string {
		if (err instanceof ConnectError) {
			switch (err.code) {
				case Code.Unavailable:
					// Backend PocketSign integration not yet configured (Section 0).
					return 'verifyCallback.error.unavailable'
				case Code.FailedPrecondition:
					// Session not completed, expired, or verification result invalid.
					return 'verifyCallback.error.notCompleted'
				case Code.AlreadyExists:
					// This person already has an IDENTITY_VERIFIED account.
					return 'verifyCallback.error.alreadyVerified'
				case Code.PermissionDenied:
					// Anti-redirect nonce mismatch validated by the backend.
					return 'verifyCallback.error.permissionDenied'
				default:
					return 'verifyCallback.error.generic'
			}
		}
		return 'verifyCallback.error.generic'
	}
}
