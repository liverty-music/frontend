import {
	UserManager,
	type UserManager as UserManagerType,
} from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService, IAuthService } from '../src/services/auth-service'
import { createTestContainer } from './helpers/create-container'

// Mock oidc-client-ts
vi.mock('oidc-client-ts')

interface MockUserManagerEvents {
	addUserLoaded: ReturnType<typeof vi.fn>
	addUserUnloaded: ReturnType<typeof vi.fn>
}

interface MockUserManager {
	signinRedirect: ReturnType<typeof vi.fn>
	signinCallback: ReturnType<typeof vi.fn>
	signinSilent: ReturnType<typeof vi.fn>
	signoutRedirect: ReturnType<typeof vi.fn>
	getUser: ReturnType<typeof vi.fn>
	events: MockUserManagerEvents
}

describe('AuthService', () => {
	let sut: IAuthService
	let userManagerMock: MockUserManager

	beforeEach(() => {
		userManagerMock = {
			signinRedirect: vi.fn(),
			signinCallback: vi.fn().mockResolvedValue({
				profile: { preferred_username: 'test-user' },
			}),
			signinSilent: vi.fn().mockResolvedValue(null),
			signoutRedirect: vi.fn(),
			getUser: vi.fn().mockResolvedValue(null),
			events: {
				addUserLoaded: vi.fn(),
				addUserUnloaded: vi.fn(),
			},
		}
		vi.mocked(UserManager).mockImplementation(
			() => userManagerMock as unknown as UserManagerType,
		)

		const container = createTestContainer()
		container.register(AuthService)
		sut = container.get(IAuthService)
	})

	it('should initialize UserManager', () => {
		expect(UserManager).toHaveBeenCalled()
	})

	it('isAuthenticated should reflect user state via events', async () => {
		expect(sut.isAuthenticated).toBe(false)

		// Simulate user loaded via the addUserLoaded event callback
		const userLoadedCallback =
			userManagerMock.events.addUserLoaded.mock.calls[0][0]

		userLoadedCallback({ expired: false, profile: { preferred_username: 'u' } })
		expect(sut.isAuthenticated).toBe(true)

		// Simulate expired user loaded
		userLoadedCallback({ expired: true, profile: { preferred_username: 'u' } })
		expect(sut.isAuthenticated).toBe(false)
	})

	it('should set isAuthenticated to false when user is unloaded', () => {
		// First load a user
		const userLoadedCallback =
			userManagerMock.events.addUserLoaded.mock.calls[0][0]
		userLoadedCallback({ expired: false, profile: { preferred_username: 'u' } })
		expect(sut.isAuthenticated).toBe(true)

		// Then unload
		const userUnloadedCallback =
			userManagerMock.events.addUserUnloaded.mock.calls[0][0]
		userUnloadedCallback()
		expect(sut.isAuthenticated).toBe(false)
	})

	it('ready resolves after initial getUser completes', async () => {
		await sut.ready
		expect(userManagerMock.getUser).toHaveBeenCalledOnce()
	})

	// Build a fresh AuthService after the getUser/signinSilent mocks have been
	// arranged, so the constructor's boot-time restore observes them.
	const buildSut = (): IAuthService => {
		const container = createTestContainer()
		container.register(AuthService)
		return container.get(IAuthService)
	}

	it('restores the session via signinSilent when the stored access token is expired', async () => {
		const renewedUser = {
			expired: false,
			profile: { preferred_username: 'renewed-user' },
		}
		userManagerMock.getUser.mockResolvedValue({
			expired: true,
			profile: { preferred_username: 'stale-user' },
		})
		userManagerMock.signinSilent.mockResolvedValue(renewedUser)

		const freshSut = buildSut()
		await freshSut.ready

		expect(userManagerMock.signinSilent).toHaveBeenCalledOnce()
		expect(freshSut.isAuthenticated).toBe(true)
		expect(freshSut.user?.profile.preferred_username).toBe('renewed-user')
	})

	it('ends unauthenticated when signinSilent fails for an expired token', async () => {
		userManagerMock.getUser.mockResolvedValue({
			expired: true,
			profile: { preferred_username: 'stale-user' },
		})
		userManagerMock.signinSilent.mockRejectedValue(new Error('refresh failed'))

		const freshSut = buildSut()
		await freshSut.ready

		expect(userManagerMock.signinSilent).toHaveBeenCalledOnce()
		expect(freshSut.isAuthenticated).toBe(false)
		expect(freshSut.user).toBeNull()
	})

	it('does not call signinSilent when the stored access token is still valid', async () => {
		userManagerMock.getUser.mockResolvedValue({
			expired: false,
			profile: { preferred_username: 'valid-user' },
		})

		const freshSut = buildSut()
		await freshSut.ready

		expect(userManagerMock.signinSilent).not.toHaveBeenCalled()
		expect(freshSut.isAuthenticated).toBe(true)
	})

	it('signIn calls signinRedirect', async () => {
		await sut.signIn()
		expect(userManagerMock.signinRedirect).toHaveBeenCalled()
	})

	it('signUp calls signinRedirect with prompt=create', async () => {
		await sut.signUp()
		expect(userManagerMock.signinRedirect).toHaveBeenCalledWith({
			prompt: 'create',
		})
	})

	it('signOut calls signoutRedirect', async () => {
		await sut.signOut()
		expect(userManagerMock.signoutRedirect).toHaveBeenCalled()
	})

	it('handleCallback calls signinCallback, updates state, and returns the user', async () => {
		const result = await sut.handleCallback()
		expect(userManagerMock.signinCallback).toHaveBeenCalled()
		expect(sut.isAuthenticated).toBe(true)
		expect(sut.user?.profile.preferred_username).toBe('test-user')
		expect(result.profile.preferred_username).toBe('test-user')
	})

	it('handleCallback throws when signinCallback returns no user', async () => {
		userManagerMock.signinCallback.mockResolvedValue(null)

		await expect(sut.handleCallback()).rejects.toThrow(/no user/)
	})
})
