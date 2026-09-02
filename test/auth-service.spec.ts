import { IEventAggregator, Registration } from 'aurelia'
import {
	type User,
	UserManager,
	type UserManager as UserManagerType,
} from 'oidc-client-ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AuthService,
	IAuthService,
	resolveAuthFlow,
} from '../src/services/auth-service'
import {
	RETURN_TO_KEY,
	RETURN_TO_TTL_MS,
} from '../shared/services/auth-service'
import { createTestContainer } from './helpers/create-container'

const nowSec = () => Math.floor(Date.now() / 1000)

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
	removeUser: ReturnType<typeof vi.fn>
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
			removeUser: vi.fn().mockResolvedValue(undefined),
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

	it('signIn calls signinRedirect without a sign-up flow marker', async () => {
		await sut.signIn()
		expect(userManagerMock.signinRedirect).toHaveBeenCalled()
		// The sign-in flow must NOT carry the sign-up flow marker, otherwise the
		// auth-callback would wrongly celebrate a returning sign-in.
		const arg = userManagerMock.signinRedirect.mock.calls[0]?.[0] ?? {}
		expect(arg.state).toBeUndefined()
	})

	it('signUp calls signinRedirect with prompt=create and the sign-up flow marker', async () => {
		await sut.signUp()
		expect(userManagerMock.signinRedirect).toHaveBeenCalledWith({
			prompt: 'create',
			state: { flow: 'signup' },
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

	// --- graceful-session-reauth additions ------------------------------------

	afterEach(() => {
		sessionStorage.clear()
	})

	/** Grab the visibilitychange handler THIS instance registered, so we can
	 *  invoke it in isolation without firing listeners other test instances left
	 *  on the shared jsdom document. */
	const buildSutWithResumeHandler = (): {
		s: IAuthService
		fire: () => void
	} => {
		const addSpy = vi.spyOn(document, 'addEventListener')
		const container = createTestContainer()
		container.register(AuthService)
		const s = container.get(IAuthService)
		const call = [...addSpy.mock.calls]
			.reverse()
			.find(([type]) => type === 'visibilitychange')
		const handler = call?.[1] as EventListener
		addSpy.mockRestore()
		return {
			s,
			fire: () => handler(new Event('visibilitychange')),
		}
	}

	const setVisible = (visible: boolean) => {
		Object.defineProperty(document, 'visibilityState', {
			value: visible ? 'visible' : 'hidden',
			configurable: true,
		})
	}

	it('ensureFreshToken is single-flight: concurrent calls run one signinSilent', async () => {
		let resolveSignin: (u: unknown) => void = () => {}
		const deferred = new Promise((r) => {
			resolveSignin = r
		})
		userManagerMock.getUser.mockResolvedValue({ expired: false, profile: {} })
		const freshSut = buildSut()
		await freshSut.ready
		userManagerMock.signinSilent.mockReturnValue(deferred)

		const p1 = freshSut.ensureFreshToken()
		const p2 = freshSut.ensureFreshToken()
		await Promise.resolve()

		expect(userManagerMock.signinSilent).toHaveBeenCalledTimes(1)
		resolveSignin({ access_token: 'x' })
		const [u1, u2] = await Promise.all([p1, p2])
		expect(u1).toEqual({ access_token: 'x' })
		expect(u2).toEqual({ access_token: 'x' })
		expect(userManagerMock.signinSilent).toHaveBeenCalledTimes(1)
	})

	it('ensureFreshToken returns null (never throws) when signinSilent fails', async () => {
		userManagerMock.getUser.mockResolvedValue({ expired: false, profile: {} })
		const freshSut = buildSut()
		await freshSut.ready
		userManagerMock.signinSilent.mockRejectedValue(new Error('boom'))

		await expect(freshSut.ensureFreshToken()).resolves.toBeNull()
	})

	it('resume refreshes a stale token on visibilitychange', async () => {
		userManagerMock.getUser.mockResolvedValue(null) // guest boot, no refresh
		const { s, fire } = buildSutWithResumeHandler()
		await s.ready
		// Authenticate with a token expiring within the skew window (~60s).
		const loaded = userManagerMock.events.addUserLoaded.mock.calls.at(-1)?.[0]
		loaded?.({ expired: false, expires_at: nowSec() + 5, profile: {} })
		userManagerMock.signinSilent.mockClear()

		setVisible(true)
		fire()
		await Promise.resolve()
		await Promise.resolve()

		expect(userManagerMock.signinSilent).toHaveBeenCalledTimes(1)
	})

	it('resume does NOT refresh a still-fresh token', async () => {
		userManagerMock.getUser.mockResolvedValue(null)
		const { s, fire } = buildSutWithResumeHandler()
		await s.ready
		const loaded = userManagerMock.events.addUserLoaded.mock.calls.at(-1)?.[0]
		loaded?.({ expired: false, expires_at: nowSec() + 600, profile: {} })
		userManagerMock.signinSilent.mockClear()

		setVisible(true)
		fire()
		await Promise.resolve()
		await Promise.resolve()

		expect(userManagerMock.signinSilent).not.toHaveBeenCalled()
	})

	it('resume is a no-op when the tab is hidden', async () => {
		userManagerMock.getUser.mockResolvedValue(null)
		const { s, fire } = buildSutWithResumeHandler()
		await s.ready
		const loaded = userManagerMock.events.addUserLoaded.mock.calls.at(-1)?.[0]
		loaded?.({ expired: false, expires_at: nowSec() + 5, profile: {} })
		userManagerMock.signinSilent.mockClear()

		setVisible(false)
		fire()
		await Promise.resolve()

		expect(userManagerMock.signinSilent).not.toHaveBeenCalled()
	})

	it('prepareForcedReauth publishes SignedOut, clears the user, and stores return-to', async () => {
		const publish = vi.fn()
		const container = createTestContainer(
			Registration.instance(IEventAggregator, {
				publish,
				subscribe: vi.fn(),
			}),
		)
		container.register(AuthService)
		const s = container.get(IAuthService)
		await s.ready

		await s.prepareForcedReauth('/organizers?x=1')

		expect(publish).toHaveBeenCalledTimes(1)
		expect(publish.mock.calls[0][0].constructor.name).toBe('SignedOut')
		expect(userManagerMock.removeUser).toHaveBeenCalledTimes(1)
		expect(JSON.parse(sessionStorage.getItem(RETURN_TO_KEY) ?? '{}').loc).toBe(
			'/organizers?x=1',
		)
	})

	it('takeReturnTo returns and clears the stored location, then null', async () => {
		await sut.prepareForcedReauth('/approval-queue')
		expect(sut.takeReturnTo()).toBe('/approval-queue')
		// One-shot: a second read is null.
		expect(sut.takeReturnTo()).toBeNull()
	})

	it('takeReturnTo ignores a stale return-to past its TTL', async () => {
		vi.useFakeTimers()
		try {
			await sut.prepareForcedReauth('/approval-queue')
			// Advance past the 10-minute TTL: an abandoned re-auth must not hijack a
			// later, unrelated sign-in in the same tab session.
			vi.advanceTimersByTime(RETURN_TO_TTL_MS + 60_000)
			expect(sut.takeReturnTo()).toBeNull()
			// The stale entry is still cleared, so it cannot linger.
			expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it('prepareForcedReauth is single-shot: only the first call initiates cleanup', async () => {
		const publish = vi.fn()
		const container = createTestContainer(
			Registration.instance(IEventAggregator, {
				publish,
				subscribe: vi.fn(),
			}),
		)
		container.register(AuthService)
		const s = container.get(IAuthService)
		await s.ready

		const first = await s.prepareForcedReauth('/a')
		const second = await s.prepareForcedReauth('/b')

		expect(first).toBe(true)
		expect(second).toBe(false)
		// Only the first published SignedOut and removed the user.
		expect(publish).toHaveBeenCalledTimes(1)
		expect(userManagerMock.removeUser).toHaveBeenCalledTimes(1)
		// The second call did not overwrite the first's return-to.
		expect(JSON.parse(sessionStorage.getItem(RETURN_TO_KEY) ?? '{}').loc).toBe(
			'/a',
		)
	})

	it('releaseForcedReauthLatch re-arms prepareForcedReauth after a failed hand-off', async () => {
		const container = createTestContainer(
			Registration.instance(IEventAggregator, {
				publish: vi.fn(),
				subscribe: vi.fn(),
			}),
		)
		container.register(AuthService)
		const s = container.get(IAuthService)
		await s.ready

		expect(await s.prepareForcedReauth('/a')).toBe(true)
		// Latch is set — a concurrent 401 is deduped.
		expect(await s.prepareForcedReauth('/b')).toBe(false)
		// The terminal redirect failed; releasing the latch lets a later 401 retry.
		s.releaseForcedReauthLatch()
		expect(await s.prepareForcedReauth('/c')).toBe(true)
	})

	it('resume does NOT refresh while on the /auth/callback route', async () => {
		window.history.pushState({}, '', '/auth/callback?code=x')
		userManagerMock.getUser.mockResolvedValue(null)
		const { s, fire } = buildSutWithResumeHandler()
		await s.ready
		const loaded = userManagerMock.events.addUserLoaded.mock.calls.at(-1)?.[0]
		loaded?.({ expired: false, expires_at: nowSec() + 5, profile: {} })
		userManagerMock.signinSilent.mockClear()

		setVisible(true)
		fire()
		await Promise.resolve()
		await Promise.resolve()

		expect(userManagerMock.signinSilent).not.toHaveBeenCalled()
		window.history.pushState({}, '', '/')
	})
})

describe('resolveAuthFlow', () => {
	it("returns 'signup' when the sign-up marker round-tripped through state", () => {
		const user = { state: { flow: 'signup' } } as unknown as User
		expect(resolveAuthFlow(user)).toBe('signup')
	})

	it('returns undefined for a sign-in (no state)', () => {
		const user = { state: undefined } as unknown as User
		expect(resolveAuthFlow(user)).toBeUndefined()
	})

	it('returns undefined when state carries no flow marker', () => {
		const user = { state: { other: true } } as unknown as User
		expect(resolveAuthFlow(user)).toBeUndefined()
	})
})
