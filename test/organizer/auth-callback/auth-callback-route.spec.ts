import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'
import { createMockAuth } from '../../helpers/mock-auth'

// Mock IAuthService so the route binds to a test double rather than
// constructing a real UserManager (oidc-client-ts).
const mockIAuthService = DI.createInterface('IAuthService')

vi.mock('../../../shared/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const { AuthCallbackRoute, CALLBACK_RETRY_FLAG } = await import(
	'../../../organizer/auth-callback/auth-callback-route'
)

const STATE_MISS = new Error('No matching state found in storage')

describe('Organizer AuthCallbackRoute', () => {
	let sut: InstanceType<typeof AuthCallbackRoute>
	let mockAuth: ReturnType<typeof createMockAuth>

	function build(authOverrides: Parameters<typeof createMockAuth>[0]) {
		mockAuth = createMockAuth(authOverrides)
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
		)
		container.register(AuthCallbackRoute)
		sut = container.get(AuthCallbackRoute)
	}

	beforeEach(() => {
		window.sessionStorage.clear()
		build({})
	})

	it('completes the code exchange and routes to welcome on success', async () => {
		build({})
		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('/welcome')
		expect(mockAuth.handleCallback).toHaveBeenCalledTimes(1)
	})

	it('clears a stale retry flag on a successful callback', async () => {
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
		build({})

		await sut.canLoad({} as never, {} as never)

		expect(window.sessionStorage.getItem(CALLBACK_RETRY_FLAG)).toBeNull()
	})

	it('self-heals a cross-context state miss by restarting sign-in once', async () => {
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		// Aborts the in-app nav (the browser redirects to Zitadel) and restarts
		// sign-in exactly once, marking the one-shot flag.
		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
		expect(window.sessionStorage.getItem(CALLBACK_RETRY_FLAG)).toBe('1')
	})

	it('does not restart sign-in a second time; shows the error instead', async () => {
		// Simulate that a prior callback already consumed the one-shot retry.
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.error).toContain('No matching state found in storage')
	})

	it('does not restart sign-in for a non-recoverable callback error', async () => {
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi
			.fn()
			.mockRejectedValue(new Error('token endpoint 500'))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.error).toContain('token endpoint 500')
	})

	it('recovers to welcome when a prior callback already established the session', async () => {
		build({ isAuthenticated: true })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('/welcome')
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})
})
