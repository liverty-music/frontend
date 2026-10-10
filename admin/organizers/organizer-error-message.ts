import { Code, ConnectError } from '@connectrpc/connect'

/** ALREADY_EXISTS copy for AssociateArtist: the artist is already claimed. */
export const ARTIST_ALREADY_REPRESENTED =
	'That artist is already represented by an organizer.'
/** ALREADY_EXISTS copy for Create: the operator email belongs to another account. */
export const OPERATOR_EMAIL_IN_USE =
	'That operator email is already used by another account. Use a different email.'

/**
 * Maps a caller error to user-facing copy. Connect error codes documented on
 * the RPCs (NOT_FOUND, ALREADY_EXISTS, FAILED_PRECONDITION, INVALID_ARGUMENT)
 * get purpose-written messages; anything else falls back to the raw message.
 * ALREADY_EXISTS means something different per RPC, so callers pass the copy
 * for their RPC in `alreadyExists`.
 */
export function toUserMessage(
	err: unknown,
	fallback: string,
	alreadyExists = ARTIST_ALREADY_REPRESENTED,
): string {
	if (err instanceof ConnectError) {
		switch (err.code) {
			case Code.AlreadyExists:
				return alreadyExists
			case Code.NotFound:
				return 'The organizer or artist no longer exists.'
			case Code.FailedPrecondition:
				return 'This organizer is deactivated and can no longer be changed.'
			case Code.InvalidArgument:
				return err.rawMessage || 'The request was invalid. Check the fields.'
			case Code.Unauthenticated:
				// Never surface the raw transport-level token error (e.g.
				// `... "exp" not satisfied`). The auth-retry interceptor is
				// re-authenticating; show a neutral, human-readable state.
				return 'Your session expired — signing you back in…'
			default:
				return err.rawMessage || fallback
		}
	}
	return err instanceof Error ? err.message : fallback
}
