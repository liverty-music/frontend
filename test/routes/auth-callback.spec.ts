import type { RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallback } from '../../src/routes/auth-callback'
import { IAuthService } from '../../src/services/auth-service'
import { IGuestDataMergeService } from '../../src/services/guest-data-merge-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../src/services/onboarding-service'
import { IUserService } from '../../src/services/user-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

function createMockUserService() {
	return {
		client: {
			create: vi.fn().mockResolvedValue({}),
		},
		ensureLoaded: vi.fn().mockResolvedValue(undefined),
	}
}

function createMockMergeService() {
	return {
		merge: vi.fn().mockResolvedValue(undefined),
	}
}

function createMockOnboardingService(
	overrides: Partial<{
		currentStep: number
		isOnboarding: boolean
	}> = {},
) {
	return {
		currentStep: overrides.currentStep ?? OnboardingStep.COMPLETED,
		isOnboarding: overrides.isOnboarding ?? false,
		setStep: vi.fn(),
		complete: vi.fn(),
		reset: vi.fn(),
		isCompleted: true,
		getRouteForCurrentStep: vi.fn().mockReturnValue(''),
	}
}

describe('AuthCallback', () => {
	let sut: AuthCallback
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockUserService: ReturnType<typeof createMockUserService>
	let mockMergeService: ReturnType<typeof createMockMergeService>
	let mockOnboarding: ReturnType<typeof createMockOnboardingService>

	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: false,
			ready: Promise.resolve(),
		})
		mockUserService = createMockUserService()
		mockMergeService = createMockMergeService()
		mockOnboarding = createMockOnboardingService()

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IUserService, mockUserService as IUserService),
			Registration.instance(
				IGuestDataMergeService,
				mockMergeService as IGuestDataMergeService,
			),
			Registration.instance(
				IOnboardingService,
				mockOnboarding as IOnboardingService,
			),
		)
		container.register(AuthCallback)
		sut = container.get(AuthCallback)
	})

	describe('canLoad', () => {
		it('should redirect to dashboard and merge on tutorial signup', async () => {
			// Tutorial signup: onboarding step is SIGNUP
			mockOnboarding.currentStep = OnboardingStep.SIGNUP
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.client.create).toHaveBeenCalled()
			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('should redirect to dashboard on sign-in and provision user', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.client.create).toHaveBeenCalled()
			expect(mockMergeService.merge).not.toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('should redirect to dashboard when state is undefined', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
		})

		it('should redirect to dashboard on error if already authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('callback error'))
			mockAuth.isAuthenticated = true

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
			expect(sut.error).toBe('')
		})

		it('should show error when callback fails and not authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('auth failed'))
			mockAuth.isAuthenticated = false

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: auth failed')
		})

		it('should handle provisionUser ALREADY_EXISTS gracefully', async () => {
			mockOnboarding.currentStep = OnboardingStep.SIGNUP
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})
			mockUserService.client.create = vi
				.fn()
				.mockRejectedValue(new ConnectError('exists', Code.AlreadyExists))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
		})

		it('should show error when provisionUser fails with non-AlreadyExists error', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})
			mockUserService.client.create = vi
				.fn()
				.mockRejectedValue(new Error('server error'))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: server error')
		})

		it('should skip provisionUser when email is missing', async () => {
			mockOnboarding.currentStep = OnboardingStep.SIGNUP
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: {},
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.client.create).not.toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('should complete onboarding when login happens during onboarding', async () => {
			mockOnboarding.currentStep = OnboardingStep.DISCOVER
			mockOnboarding.isOnboarding = true
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'user@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockOnboarding.complete).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})
	})
})
