import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthStatus } from '../../src/components/auth-status'
import { IAuthService } from '../../src/services/auth-service'
import { IUserService } from '../../src/services/user-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

describe('AuthStatus', () => {
	let sut: AuthStatus
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockUserService: { clear: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockAuth = createMockAuth()
		mockUserService = { clear: vi.fn() }
		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IUserService, mockUserService as never),
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

	it('clears the user cache before signing out', async () => {
		// Act
		await sut.signOut()

		// Assert: both called, with clear preceding signOut so the localStorage
		// entry does not outlive the session.
		expect(mockUserService.clear).toHaveBeenCalledOnce()
		expect(mockAuth.signOut).toHaveBeenCalledOnce()
		expect(mockUserService.clear.mock.invocationCallOrder[0]).toBeLessThan(
			(mockAuth.signOut as ReturnType<typeof vi.fn>).mock
				.invocationCallOrder[0],
		)
	})

	it('should expose auth service for template bindings', () => {
		// Arrange
		mockAuth.isAuthenticated = true

		// Assert
		expect(sut.auth).toBeDefined()
		expect(sut.auth.isAuthenticated).toBe(true)
	})
})
