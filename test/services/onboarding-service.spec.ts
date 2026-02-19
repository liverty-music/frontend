import { IRouter } from '@aurelia/router'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IArtistServiceClient } from '../../src/services/artist-service-client'
import { IAuthService } from '../../src/services/auth-service'
import {
	IOnboardingService,
	OnboardingService,
} from '../../src/services/onboarding-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'
import { createMockArtistServiceClient } from '../helpers/mock-rpc-clients'

describe('OnboardingService', () => {
	let sut: OnboardingService
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockArtistService: ReturnType<typeof createMockArtistServiceClient>
	let mockRouter: Partial<IRouter>

	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: true,
			ready: Promise.resolve(),
		})
		mockArtistService = createMockArtistServiceClient()
		mockRouter = {
			load: vi.fn().mockResolvedValue(true),
		}

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IArtistServiceClient, mockArtistService),
			Registration.instance(IRouter, mockRouter as IRouter),
		)
		container.register(OnboardingService)
		sut = container.get(IOnboardingService)
	})

	describe('hasCompletedOnboarding', () => {
		it('should return true when user has followed artists', async () => {
			// Arrange
			mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
				artists: [{ id: { value: 'artist-1' }, name: { value: 'Artist' } }],
			})

			// Act
			const result = await sut.hasCompletedOnboarding()

			// Assert
			expect(result).toBe(true)
		})

		it('should return false when user has no followed artists', async () => {
			// Arrange
			mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
				artists: [],
			})

			// Act
			const result = await sut.hasCompletedOnboarding()

			// Assert
			expect(result).toBe(false)
		})
	})

	describe('redirectBasedOnStatus', () => {
		it('should navigate to dashboard when authenticated and onboarded', async () => {
			// Arrange
			mockAuth.isAuthenticated = true
			mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
				artists: [{ id: { value: 'artist-1' } }],
			})

			// Act
			await sut.redirectBasedOnStatus()

			// Assert
			expect(mockRouter.load).toHaveBeenCalledWith('dashboard')
		})

		it('should navigate to onboarding when authenticated but not onboarded', async () => {
			// Arrange
			mockAuth.isAuthenticated = true
			mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
				artists: [],
			})

			// Act
			await sut.redirectBasedOnStatus()

			// Assert
			expect(mockRouter.load).toHaveBeenCalledWith('onboarding/discover')
		})

		it('should not navigate when not authenticated', async () => {
			// Arrange
			mockAuth.isAuthenticated = false

			// Act
			await sut.redirectBasedOnStatus()

			// Assert
			expect(mockRouter.load).not.toHaveBeenCalled()
		})

		it('should wait for auth ready before checking status', async () => {
			// Arrange
			let resolveReady: () => void
			const readyPromise = new Promise<void>((resolve) => {
				resolveReady = resolve
			})
			mockAuth.ready = readyPromise
			mockAuth.isAuthenticated = true
			mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
				artists: [{ id: { value: 'artist-1' } }],
			})

			// Act
			const redirectPromise = sut.redirectBasedOnStatus()

			// Assert - should not have called router yet
			expect(mockRouter.load).not.toHaveBeenCalled()

			// Resolve auth ready
			resolveReady!()
			await redirectPromise

			// Now router should have been called
			expect(mockRouter.load).toHaveBeenCalledWith('dashboard')
		})
	})
})
