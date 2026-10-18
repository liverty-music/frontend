import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it } from 'vitest'
import {
	SESSION_EXPIRED,
	toUserMessage,
} from '../../../admin/services/error-message'

const SPEC = 'components/infrastructure/admin/web/global/error-messages'

describe('toUserMessage', () => {
	it(`@spec ${SPEC} "Failure without an error code"`, () => {
		expect(
			toUserMessage(
				new TypeError('Failed to fetch'),
				'Failed to load published concerts.',
			),
		).toBe('Failed to load published concerts.')
		expect(toUserMessage('not an error', 'Delete failed.')).toBe(
			'Delete failed.',
		)
	})

	it(`@spec ${SPEC} "Session expired during a call"`, () => {
		expect(
			toUserMessage(
				new ConnectError('token "exp" not satisfied', Code.Unauthenticated),
				'Failed to load the approval queue.',
			),
		).toBe(SESSION_EXPIRED)
		expect(SESSION_EXPIRED).toBe('Your session expired — signing you back in…')
	})

	it('returns the override for its code and never the server message', () => {
		const err = new ConnectError(
			'short name taken (already_exists)',
			Code.AlreadyExists,
		)
		expect(
			toUserMessage(err, 'Failed.', { [Code.AlreadyExists]: 'Taken.' }),
		).toBe('Taken.')
		expect(toUserMessage(err, 'Failed.')).toBe('Failed.')
	})

	it('an override for Unauthenticated wins over the session copy', () => {
		expect(
			toUserMessage(new ConnectError('x', Code.Unauthenticated), 'Failed.', {
				[Code.Unauthenticated]: 'Custom.',
			}),
		).toBe('Custom.')
	})
})
