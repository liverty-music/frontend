import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrganizerAuthRetryInterceptor } from '../../../organizer/services/organizer-auth-retry-interceptor'
import type { IAuthService } from '../../../shared/services/auth-service'
import { createMockAuth } from '../../helpers/mock-auth'

function makeRequest() {
	return {
		header: new Headers(),
		service: { typeName: 'OrganizerService' },
		method: { name: 'Get' },
	} as never
}

describe('createOrganizerAuthRetryInterceptor', () => {
	let mockAuth: ReturnType<typeof createMockAuth>

	beforeEach(() => {
		mockAuth = createMockAuth()
		// The refresh token can no longer be renewed.
		mockAuth.ensureFreshToken = vi.fn().mockResolvedValue(null)
	})

	// @spec components/infrastructure/organizer/web/global/i18n "Operator who chose English on a Japanese browser"
	it('signs in again with the hosted login in the language the console shows', async () => {
		const language = { current: 'en' as const }
		const error = new ConnectError('exp not satisfied', Code.Unauthenticated)
		const next = vi.fn().mockRejectedValue(error)
		const handler = createOrganizerAuthRetryInterceptor(
			mockAuth as unknown as IAuthService,
			language,
		)(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)

		expect(mockAuth.signIn).toHaveBeenCalledExactlyOnceWith({
			uiLocales: 'en',
		})
	})

	it('reads the language when the sign-in starts, not when the transport is built', async () => {
		const language: { current: 'ja' | 'en' } = { current: 'ja' }
		const next = vi
			.fn()
			.mockRejectedValue(new ConnectError('exp', Code.Unauthenticated))
		const handler = createOrganizerAuthRetryInterceptor(
			mockAuth as unknown as IAuthService,
			language,
		)(next)
		// The member switched the language after the client was created.
		language.current = 'en'

		await expect(handler(makeRequest())).rejects.toThrow()

		expect(mockAuth.signIn).toHaveBeenCalledWith({ uiLocales: 'en' })
	})
})
