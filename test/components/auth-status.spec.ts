import { I18N } from '@aurelia/i18n'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthStatus } from '../../src/components/auth-status'
import { IAuthService } from '../../src/services/auth-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

describe('AuthStatus', () => {
	let sut: AuthStatus
	let mockAuth: ReturnType<typeof createMockAuth>
	let i18n: I18N

	beforeEach(() => {
		mockAuth = createMockAuth()
		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
		)
		container.register(AuthStatus)
		sut = container.get(AuthStatus)
		i18n = container.get(I18N)
	})

	it('should call auth.signIn when signIn is invoked', async () => {
		// Act
		await sut.signIn()

		// Assert
		expect(mockAuth.signIn).toHaveBeenCalledWith({ uiLocales: 'ja' })
	})

	it('should call auth.signUp when signUp is invoked', async () => {
		// Act
		await sut.signUp()

		// Assert
		expect(mockAuth.signUp).toHaveBeenCalledWith({ uiLocales: 'ja' })
	})

	// @spec components/infrastructure/fan/web/global/i18n "Sign up in English"
	it('asks the hosted sign-up for the language the app shows', async () => {
		await i18n.setLocale('en')

		await sut.signUp()

		expect(mockAuth.signUp).toHaveBeenCalledWith({ uiLocales: 'en' })
	})

	it('should call auth.signOut when signOut is invoked', async () => {
		// Act
		await sut.signOut()

		// Assert
		expect(mockAuth.signOut).toHaveBeenCalled()
	})

	it('should expose auth service for template bindings', () => {
		// Arrange
		mockAuth.isAuthenticated = true

		// Assert
		expect(sut.auth).toBeDefined()
		expect(sut.auth.isAuthenticated).toBe(true)
	})
})
