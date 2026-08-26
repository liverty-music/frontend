import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it } from 'vitest'
import { toOrganizerErrorMessage } from '../../../organizer/services/connect-error-copy'

describe('toOrganizerErrorMessage', () => {
	it('maps PERMISSION_DENIED to non-revealing copy', () => {
		const err = new ConnectError('nope', Code.PermissionDenied)
		expect(toOrganizerErrorMessage(err, 'fallback')).toContain('not allowed')
	})

	it('surfaces the raw message for INVALID_ARGUMENT', () => {
		const err = new ConnectError('title is required', Code.InvalidArgument)
		expect(toOrganizerErrorMessage(err, 'fallback')).toBe('title is required')
	})

	it('applies a per-code override when supplied', () => {
		const err = new ConnectError('x', Code.FailedPrecondition)
		const msg = toOrganizerErrorMessage(err, 'fallback', {
			[Code.FailedPrecondition]: 'already cancelled',
		})
		expect(msg).toBe('already cancelled')
	})

	it('falls back for an unrecognised code', () => {
		const err = new ConnectError('boom', Code.Internal)
		expect(toOrganizerErrorMessage(err, 'fallback')).toBe('boom')
	})

	it('handles a plain Error', () => {
		expect(toOrganizerErrorMessage(new Error('plain'), 'fallback')).toBe(
			'plain',
		)
	})

	it('uses the fallback for a non-error value', () => {
		expect(toOrganizerErrorMessage('weird', 'fallback')).toBe('fallback')
	})
})
