import type { RouteNode } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import type { User } from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'
import { createMockAuth } from '../../helpers/mock-auth'

// Mock IAuthService and ILoginHint so the guard binds to test doubles rather
// than constructing a real UserManager (oidc-client-ts) or reading window.location.
const mockIAuthService = DI.createInterface('IAuthService')
const mockILoginHint = DI.createInterface<string | null>('ILoginHint')

vi.mock('../../../shared/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../../organizer/services/login-hint', () => ({
	ILoginHint: mockILoginHint,
}))

const { OrganizerAuthHook } = await import('../../../organizer/hooks/auth-hook')

const ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'

function makeRouteNode(data?: Record<string, unknown>): RouteNode {
	return { data } as unknown as RouteNode
}

function userWithRoles(roles: Record<string, unknown>): User {
	return { profile: { [ROLES_CLAIM]: roles } } as unknown as User
}

describe('OrganizerAuthHook', () => {
	let sut: InstanceType<typeof OrganizerAuthHook>
	let mockAuth: ReturnType<typeof createMockAuth>

	function build(
		authOverrides: Parameters<typeof createMockAuth>[0],
		loginHint: string | null = null,
	) {
		mockAuth = createMockAuth(authOverrides)
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockILoginHint, loginHint),
		)
		container.register(OrganizerAuthHook)
		sut = container.get(OrganizerAuthHook)
	}

	beforeEach(() => {
		build({ isAuthenticated: true, user: userWithRoles({ owner: {} }) })
	})

	it('allows the unguarded callback route (auth: false) without checking auth', async () => {
		build({ isAuthenticated: false })
		const next = makeRouteNode({ auth: false })

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('redirects an unauthenticated visitor into the sign-in flow and aborts the nav', async () => {
		build({ isAuthenticated: false })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
	})

	it('passes loginHint to signIn when an invitation link is followed', async () => {
		build({ isAuthenticated: false }, 'operator@example.com')
		const next = makeRouteNode({})

		await sut.canLoad({} as never, {}, next, null)

		expect(mockAuth.signIn).toHaveBeenCalledWith({
			loginHint: 'operator@example.com',
		})
	})

	it('calls signIn with no options when loginHint is absent', async () => {
		build({ isAuthenticated: false }, null)
		const next = makeRouteNode({})

		await sut.canLoad({} as never, {}, next, null)

		expect(mockAuth.signIn).toHaveBeenCalledWith(undefined)
	})

	it('admits an authenticated operator holding the owner role', async () => {
		build({ isAuthenticated: true, user: userWithRoles({ owner: {} }) })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('routes an authenticated non-owner to the denied placeholder', async () => {
		build({ isAuthenticated: true, user: userWithRoles({ editor: {} }) })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe('/denied')
	})

	it('admits the denied placeholder itself (role: false) for a signed-in non-owner', async () => {
		build({ isAuthenticated: true, user: userWithRoles({ editor: {} }) })
		const next = makeRouteNode({ role: false })

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
	})

	it('awaits authService.ready before evaluating the session', async () => {
		let resolveReady: () => void = () => {}
		const readyPromise = new Promise<void>((r) => {
			resolveReady = r
		})
		build({
			isAuthenticated: true,
			user: userWithRoles({ owner: {} }),
			ready: readyPromise,
		})

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
