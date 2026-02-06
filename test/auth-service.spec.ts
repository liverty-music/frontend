import { DI, ILogger, Registration } from 'aurelia'
import { UserManager } from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService, IAuthService } from '../src/services/auth-service'

// Mock oidc-client-ts
vi.mock('oidc-client-ts')

describe('AuthService', () => {
	let sut: IAuthService
	// biome-ignore lint/suspicious/noExplicitAny: mock
	let userManagerMock: any

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
		// biome-ignore lint/suspicious/noExplicitAny: mock
		;(UserManager as any).mockImplementation(() => userManagerMock)

		const container = DI.createContainer()
		container.register(
			Registration.instance(ILogger, {
				scopeTo: vi.fn().mockReturnThis(),
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			}),
		)
		container.register(AuthService)
		sut = container.get(IAuthService)
	})

	it('should initialize UserManager', () => {
		expect(UserManager).toHaveBeenCalled()
	})

	it('isAuthenticated should reflect user state', async () => {
		expect(sut.isAuthenticated).toBe(false)

		// Simulate user loaded
		// @ts-expect-error - access private for test or use events
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

	it('register calls signinRedirect with prompt=create', async () => {
		await sut.register()
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
