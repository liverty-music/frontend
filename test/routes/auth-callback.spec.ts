import { IRouter } from '@aurelia/router'
import { Registration } from 'aurelia'
import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallback } from '../../src/routes/auth-callback'
import { IAuthService } from '../../src/services/auth-service'
import { IUserService } from '../../src/services/user-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

function createMockUserService() {
	return {
		client: {
			create: vi.fn().mockResolvedValue({}),
		},
	}
}

describe('AuthCallback', () => {
	let sut: AuthCallback
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockUserService: ReturnType<typeof createMockUserService>
	let mockRouter: { load: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: false,
			ready: Promise.resolve(),
		})
		mockUserService = createMockUserService()
		mockRouter = { load: vi.fn().mockResolvedValue(true) }

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IUserService, mockUserService as IUserService),
			Registration.instance(IRouter, mockRouter as IRouter),
		)
		container.register(AuthCallback)
		sut = container.get(AuthCallback)
	})

	describe('attached', () => {
		it('should redirect to discover on sign-up', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				state: { isSignUp: true },
				profile: { email: 'new@example.com' },
			})

			await sut.attached()

			expect(mockUserService.client.create).toHaveBeenCalled()
			expect(mockRouter.load).toHaveBeenCalledWith('/onboarding/discover')
		})

		it('should redirect to dashboard on sign-in', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				state: {},
				profile: { email: 'existing@example.com' },
			})

			await sut.attached()

			expect(mockUserService.client.create).not.toHaveBeenCalled()
			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})

		it('should redirect to dashboard when state is undefined', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})

			await sut.attached()

			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})

		it('should redirect to dashboard on error if already authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('callback error'))
			mockAuth.isAuthenticated = true

			await sut.attached()

			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
			expect(sut.error).toBe('')
		})

		it('should show error when callback fails and not authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('auth failed'))
			mockAuth.isAuthenticated = false

			await sut.attached()

			expect(mockRouter.load).not.toHaveBeenCalled()
			expect(sut.error).toBe('Login failed: auth failed')
		})

		it('should handle provisionUser ALREADY_EXISTS gracefully', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				state: { isSignUp: true },
				profile: { email: 'existing@example.com' },
			})
			mockUserService.client.create = vi
				.fn()
				.mockRejectedValue(new ConnectError('exists', Code.AlreadyExists))

			await sut.attached()

			expect(mockRouter.load).toHaveBeenCalledWith('/onboarding/discover')
		})

		it('should show error when provisionUser fails with non-AlreadyExists error', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				state: { isSignUp: true },
				profile: { email: 'new@example.com' },
			})
			mockUserService.client.create = vi
				.fn()
				.mockRejectedValue(new Error('server error'))

			await sut.attached()

			expect(mockRouter.load).not.toHaveBeenCalled()
			expect(sut.error).toBe('Login failed: server error')
		})

		it('should skip provisionUser when email is missing', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				state: { isSignUp: true },
				profile: {},
			})

			await sut.attached()

			expect(mockUserService.client.create).not.toHaveBeenCalled()
			expect(mockRouter.load).toHaveBeenCalledWith('/onboarding/discover')
		})
	})
})
