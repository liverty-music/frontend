import { Code, ConnectError } from '@connectrpc/connect'

/** Copy shown when a call fails with Unauthenticated. */
export const SESSION_EXPIRED = 'Your session expired — signing you back in…'

/**
 * Maps a failed call to copy the admin console owns. The copy is chosen from
 * the error code only: `overrides[code]` when the caller has copy for that
 * code, the session copy for Unauthenticated (the auth-retry interceptor is
 * re-authenticating), and `fallback` (the operation's "failed" copy) for any
 * other code and for errors that carry no code (network down, unreadable
 * response).
 *
 * It never reads the error's message: server and library text is written for
 * developers, can carry the server's `(code)` suffix and changes with any
 * release. Callers log the error, message included, to the console instead.
 */
export function toUserMessage(
	err: unknown,
	fallback: string,
	overrides: Partial<Record<Code, string>> = {},
): string {
	if (!(err instanceof ConnectError)) return fallback
	const override = overrides[err.code]
	if (override !== undefined) return override
	if (err.code === Code.Unauthenticated) return SESSION_EXPIRED
	return fallback
}
