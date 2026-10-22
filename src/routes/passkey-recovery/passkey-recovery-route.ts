import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { emailProblem } from '../../../shared/utils/email'
import { IUserRpcClient } from '../../adapter/rpc/client/user-client'

/** Seconds a fan waits after a send before they can send the link again. */
export const RESEND_WAIT_SEC = 60

/** Why the last send did not go through. */
export type PasskeyRecoveryError = 'tooMany' | 'failed'

/**
 * The "can't sign in" screen (`/passkey-recovery`): a fan who can use none of
 * their passkeys asks for an email link that registers a new passkey on the
 * device in hand (`UserService.RequestPasskeyRecovery`).
 *
 * The answer is the same whether or not an account uses the address, so the
 * screen shows one message for every successful send and never says whether
 * an account exists.
 */
export class PasskeyRecoveryRoute {
	private readonly userRpc = resolve(IUserRpcClient)
	private readonly logger = resolve(ILogger).scopeTo('PasskeyRecoveryRoute')

	public email = ''
	/** Set by a send attempt, so the field error appears only after one. */
	public submitted = false
	/** True once a send succeeded: the form gives way to the message. */
	public sent = false
	public error: PasskeyRecoveryError | null = null
	/** Seconds left before the link can be sent again; 0 when it can. */
	public resendIn = 0
	/** A request is in flight; a second tap sends nothing. */
	public sending = false

	private countdown: ReturnType<typeof setInterval> | null = null

	public get emailInvalid(): boolean {
		return this.submitted && emailProblem(this.email.trim()) !== null
	}

	/** Send the link to the typed address. */
	public async send(): Promise<void> {
		if (this.sending) return
		this.submitted = true
		if (this.emailInvalid) return
		this.error = null
		this.sending = true
		try {
			await this.userRpc.requestPasskeyRecovery(this.email.trim())
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			this.logger.warn('Passkey recovery request failed', { code: err.code })
			// Back to the form with the typed address kept.
			this.sent = false
			this.error = err.code === Code.ResourceExhausted ? 'tooMany' : 'failed'
			return
		} finally {
			this.sending = false
		}
		this.sent = true
		this.startCountdown()
	}

	public detaching(): void {
		this.stopCountdown()
	}

	private startCountdown(): void {
		this.stopCountdown()
		this.resendIn = RESEND_WAIT_SEC
		this.countdown = setInterval(() => {
			this.resendIn = Math.max(0, this.resendIn - 1)
			if (this.resendIn === 0) this.stopCountdown()
		}, 1000)
	}

	private stopCountdown(): void {
		if (this.countdown !== null) {
			clearInterval(this.countdown)
			this.countdown = null
		}
	}
}
