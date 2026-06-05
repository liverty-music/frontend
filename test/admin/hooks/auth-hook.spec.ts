import type { RouteNode } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'
import { createMockAuth } from '../../helpers/mock-auth'

// The admin guard resolves IAuthService from the shared surface. Mock that
// module so the guard binds to the test double rather than constructing a real
// UserManager (which would hit oidc-client-ts).
const mockIAuthService = DI.createInterface('IAuthService')

vi.mock('../../../shared/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const { AdminAuthHook } = await import('../../../admin/hooks/auth-hook')

function makeRouteNode(data?: Record<string, unknown>): RouteNode {
	return { data } as unknown as RouteNode
}

describe('AdminAuthHook', () => {
	let sut: InstanceType<typeof AdminAuthHook>
	let mockAuth: ReturnType<typeof createMockAuth>

	function build(authOverrides: Parameters<typeof createMockAuth>[0]) {
		mockAuth = createMockAuth(authOverrides)
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
		)
		container.register(AdminAuthHook)
		sut = container.get(AdminAuthHook)
	}

	beforeEach(() => {
		build({ isAuthenticated: true })
	})

	it('allows the unguarded callback route (auth: false) without checking auth', async () => {
		build({ isAuthenticated: false })
		const next = makeRouteNode({ auth: false })

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		// The callback route must NOT trigger a redirect to sign-in.
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('allows an authenticated visitor on a guarded route', async () => {
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('redirects an unauthenticated visitor into the sign-in flow and aborts the nav', async () => {
		build({ isAuthenticated: false })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		// Returning false aborts the in-app navigation while the OIDC redirect
		// takes the document to Zitadel — so no admin content renders.
		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
	})

	it('awaits authService.ready before evaluating the session', async () => {
		let resolveReady: () => void = () => {}
		const readyPromise = new Promise<void>((r) => {
			resolveReady = r
		})
		build({ isAuthenticated: true, ready: readyPromise })

		const next = makeRouteNode({})
		const canLoadPromise = sut.canLoad({} as never, {}, next, null)

		let settled = false
		void canLoadPromise.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		resolveReady()
		const result = await canLoadPromise
		expect(result).toBe(true)
	})
})
