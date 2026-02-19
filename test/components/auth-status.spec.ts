import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthStatus } from '../../src/components/auth-status'
import { IAuthService } from '../../src/services/auth-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

describe('AuthStatus', () => {
	let sut: AuthStatus
	let mockAuth: ReturnType<typeof createMockAuth>

	beforeEach(() => {
		mockAuth = createMockAuth()
		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
		)
		container.register(AuthStatus)
		sut = container.get(AuthStatus)
	})

	it('should call auth.signIn when signIn is invoked', async () => {
		// Act
		await sut.signIn()

		// Assert
		expect(mockAuth.signIn).toHaveBeenCalled()
	})

	it('should call auth.signUp when signUp is invoked', async () => {
		// Act
		await sut.signUp()

		// Assert
		expect(mockAuth.signUp).toHaveBeenCalled()
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
