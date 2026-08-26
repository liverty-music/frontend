import { Code, ConnectError } from '@connectrpc/connect'

/**
 * Translates a caller error into user-facing copy for the organizer console.
 *
 * The organizer RPCs document a small, stable set of `ConnectError` codes
 * (INVALID_ARGUMENT, PERMISSION_DENIED, FAILED_PRECONDITION, UNAUTHENTICATED);
 * each gets purpose-written copy, and anything else falls back to the raw
 * message or a caller-supplied fallback. Kept organizer-local (not shared with
 * admin) so its wording can speak to an organizer operator, and `FAILED_
 * PRECONDITION` in particular can be overridden per call site — Publish, Cancel,
 * Update-published, RegenerateToken, and deactivated-organizer all surface that
 * code but mean different things.
 *
 * @param err The thrown error (typically a `ConnectError`).
 * @param fallback Copy shown when the error is not a recognised `ConnectError`.
 * @param overrides Optional per-code copy overrides for the calling screen.
 */
export function toOrganizerErrorMessage(
	err: unknown,
	fallback: string,
	overrides?: Partial<Record<Code, string>>,
): string {
	if (err instanceof ConnectError) {
		const override = overrides?.[err.code]
		if (override !== undefined) return override
		switch (err.code) {
			case Code.InvalidArgument:
				return err.rawMessage || 'The request was invalid. Check the fields.'
			case Code.PermissionDenied:
				return 'You are not allowed to change this concert, or a selected performer is not one you represent.'
			case Code.FailedPrecondition:
				return err.rawMessage || 'This concert can no longer be changed.'
			case Code.Unauthenticated:
				return 'Your session has expired. Please sign in again.'
			default:
				return err.rawMessage || fallback
		}
	}
	return err instanceof Error ? err.message : fallback
}

export { Code, ConnectError }
