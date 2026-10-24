import { Code } from '@connectrpc/connect'
import { toUserMessage } from '../services/error-message'

/** Overrides for associating and removing an artist: AlreadyExists means the artist is already claimed. */
export const ROSTER_OVERRIDES: Partial<Record<Code, string>> = {
	[Code.AlreadyExists]: 'That artist is already represented by an organizer.',
}

/** Overrides for Create (spec route/organizers "A refused Create says what to change"). */
export const CREATE_OVERRIDES: Partial<Record<Code, string>> = {
	[Code.AlreadyExists]:
		'That short name is already used by another organizer. Choose a different one.',
	// After the screen's own checks of the name, short name and owner email,
	// the only InvalidArgument left is the sign-in service refusing the email.
	[Code.InvalidArgument]:
		'The sign-in service did not accept this owner email. Check it or use a different address.',
	// Provisioning can refuse a Create with FailedPrecondition; the Organizers
	// default ("deactivated") would be wrong for an Organizer that does not exist.
	[Code.FailedPrecondition]: 'Failed to create the organizer.',
}

/**
 * Delete FailedPrecondition copy: one fixed sentence naming every blocker the
 * server can report for a deactivated Organizer, whatever reason it sends.
 */
export const DELETE_REFUSED =
	'This organizer cannot be deleted while it has a paid order, a settlement that is not reversed, a purchase in progress, or a payout account.'

const ORGANIZER_DEFAULTS: Partial<Record<Code, string>> = {
	[Code.NotFound]: 'The organizer or artist no longer exists.',
	[Code.FailedPrecondition]:
		'This organizer is deactivated and can no longer be changed.',
	[Code.InvalidArgument]: 'The request was invalid. Check the fields.',
}

/**
 * Maps a failed call that changes an existing Organizer (Deactivate, Delete,
 * the artist roster, commercial terms) to copy: the Organizers screen's
 * defaults per code, then `overrides`, then {@link toUserMessage}.
 */
export function toOrganizerMessage(
	err: unknown,
	fallback: string,
	overrides: Partial<Record<Code, string>> = {},
): string {
	return toUserMessage(err, fallback, { ...ORGANIZER_DEFAULTS, ...overrides })
}

/** Maps a Delete failure to copy; FailedPrecondition gives {@link DELETE_REFUSED}. */
export function toDeleteMessage(err: unknown): string {
	return toOrganizerMessage(err, 'Failed to delete the organizer.', {
		[Code.FailedPrecondition]: DELETE_REFUSED,
	})
}
