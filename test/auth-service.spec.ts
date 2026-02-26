import type { UserManager as UserManagerType } from 'oidc-client-ts'
import { UserManager } from 'oidc-client-ts'
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

	it('isAuthenticated should reflect user state', async () => {
		expect(sut.isAuthenticated).toBe(false)

		// Simulate user loaded via the events callback registered in constructor
		// @ts-expect-error - access private for test
		sut.user = { expired: false }
		expect(sut.isAuthenticated).toBe(true)

		// Simulate expired
		// @ts-expect-error
		sut.user = { expired: true }
		expect(sut.isAuthenticated).toBe(false)
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

	it('handleCallback calls signinCallback and updates state', async () => {
		await sut.handleCallback()
		expect(userManagerMock.signinCallback).toHaveBeenCalled()
		expect(sut.isAuthenticated).toBe(true)
		expect(sut.user?.profile.preferred_username).toBe('test-user')
	})
})
