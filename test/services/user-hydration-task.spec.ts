import { ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IAuthService } from '../../src/services/auth-service'
import { IUserService } from '../../src/services/user-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

/**
 * Tests the UserHydrationTask logic directly.
 * Mirrors the AppTask.activating() callback: resolves IAuthService and IUserService
 * from the container, awaits auth.ready, calls ensureLoaded() if authenticated,
 * and catches errors to allow graceful degradation.
 */
async function runHydrationLogic(
	container: ReturnType<typeof createTestContainer>,
): Promise<void> {
	const auth = container.get(IAuthService)
	await auth.ready

	if (auth.isAuthenticated) {
		const userService = container.get(IUserService)
		try {
			await userService.ensureLoaded()
		} catch (err) {
			const logger = container.get(ILogger).scopeTo('UserHydrationTask')
			logger.warn('Failed to hydrate user profile, continuing without it', {
				error: err,
			})
		}
	}
}

describe('UserHydrationTask', () => {
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockUserService: { ensureLoaded: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockAuth = createMockAuth()
		mockUserService = {
			ensureLoaded: vi.fn().mockResolvedValue(undefined),
		}
	})

	it('should call ensureLoaded when authenticated', async () => {
		mockAuth.isAuthenticated = true

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth),
			Registration.instance(IUserService, mockUserService),
		)

		await runHydrationLogic(container)

		expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
	})

	it('should not call ensureLoaded when not authenticated', async () => {
		mockAuth.isAuthenticated = false

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth),
			Registration.instance(IUserService, mockUserService),
		)

		await runHydrationLogic(container)

		expect(mockUserService.ensureLoaded).not.toHaveBeenCalled()
	})

	it('should await authService.ready before checking authentication', async () => {
		let resolveReady: () => void
		const readyPromise = new Promise<void>((resolve) => {
			resolveReady = resolve
		})
		mockAuth.ready = readyPromise
		mockAuth.isAuthenticated = true

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth),
			Registration.instance(IUserService, mockUserService),
		)

		const runPromise = runHydrationLogic(container)

		// ensureLoaded should not have been called yet (ready not resolved)
		expect(mockUserService.ensureLoaded).not.toHaveBeenCalled()

		resolveReady!()
		await runPromise

		expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
	})

	it('should not throw when ensureLoaded fails', async () => {
		mockAuth.isAuthenticated = true
		mockUserService.ensureLoaded.mockRejectedValue(new Error('network'))

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth),
			Registration.instance(IUserService, mockUserService),
		)

		await expect(runHydrationLogic(container)).resolves.toBeUndefined()
		expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
	})
})
