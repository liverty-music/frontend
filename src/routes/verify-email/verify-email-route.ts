import type { Params, RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { IUserRpcClient } from '../../adapter/rpc/client/user-client'

/**
 * Where the screen is:
 * - `ready`: the link is read; the fan has not confirmed yet.
 * - `verifying`: the confirmation is in flight.
 * - `verified`: the address is verified.
 * - `invalid`: the link is broken, expired or already used.
 * - `tooMany`: too many attempts; try again later.
 * - `failed`: the server could not be reached; the fan can try again.
 */
export type VerifyEmailState =
	| 'ready'
	| 'verifying'
	| 'verified'
	| 'invalid'
	| 'tooMany'
	| 'failed'

/**
 * The email verification screen (`/verify-email?user=…&code=…`), opened from
 * the link in a verification email. It needs no sign-in. The address is
 * confirmed only when the fan taps the button, never on opening, so a mail
 * scanner that opens the link cannot use the code up
 * (`UserService.VerifyEmail`).
 */
export class VerifyEmailRoute {
	private readonly userRpc = resolve(IUserRpcClient)
	private readonly logger = resolve(ILogger).scopeTo('VerifyEmailRoute')

	public state: VerifyEmailState = 'ready'

	private userId = ''
	private code = ''

	public loading(_params: Params, next: RouteNode): void {
		this.userId = next.queryParams.get('user') ?? ''
		this.code = next.queryParams.get('code') ?? ''
		this.state = this.userId && this.code ? 'ready' : 'invalid'
	}

	/** Whether the confirm button is shown: before a result, or to retry. */
	public get canConfirm(): boolean {
		return (
			this.state === 'ready' ||
			this.state === 'verifying' ||
			this.state === 'failed'
		)
	}

	/** Confirm the address with the link's User and code. */
	public async confirm(): Promise<void> {
		if (this.state === 'verifying' || !this.userId || !this.code) return
		this.state = 'verifying'
		try {
			await this.userRpc.verifyEmail(this.userId, this.code)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			this.state = stateFor(err.code)
			if (this.state === 'failed') {
				this.logger.warn('Email verification failed', { code: err.code })
			}
			return
		}
		this.state = 'verified'
	}
}

/** The screen state a failed confirmation leads to. */
function stateFor(code: Code): VerifyEmailState {
	switch (code) {
		case Code.InvalidArgument:
			return 'invalid'
		case Code.ResourceExhausted:
			return 'tooMany'
		default:
			return 'failed'
	}
}
