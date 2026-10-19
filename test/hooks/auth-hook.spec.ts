import type { RouteNode } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const mockIAuthService = DI.createInterface('IAuthService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const { AuthHook } = await import('../../src/hooks/auth-hook')
const { IUserHydration } = await import(
	'../../src/services/user-hydration-task'
)

function makeRouteNode(data?: Record<string, unknown>): RouteNode {
	return { data } as unknown as RouteNode
}

function makeHook(
	mockAuth: ReturnType<typeof createMockAuth>,
	hydration: { ready: Promise<void> } = { ready: Promise.resolve() },
) {
	const container = createTestContainer(
		Registration.instance(mockIAuthService, mockAuth),
		Registration.instance(IUserHydration, hydration),
	)
	container.register(AuthHook)
	return container.get(AuthHook)
}

describe('AuthHook', () => {
	let mockAuth: ReturnType<typeof createMockAuth>

	beforeEach(() => {
		mockAuth = createMockAuth({ isAuthenticated: true })
	})

	describe('canLoad', () => {
		it('allows public routes (data.auth === false) regardless of auth', async () => {
			const sut = makeHook(createMockAuth({ isAuthenticated: false }))
			const result = await sut.canLoad(
				{},
				{},
				makeRouteNode({ auth: false }),
				null,
			)
			expect(result).toBe(true)
		})

		it('waits for the user hydration before loading a protected route', async () => {
			let hydrated: () => void = () => {}
			const sut = makeHook(mockAuth, {
				ready: new Promise<void>((r) => {
					hydrated = r
				}),
			})
			let loaded = false

			const loading = sut.canLoad({}, {}, makeRouteNode({}), null).then(() => {
				loaded = true
			})
			await Promise.resolve()
			await Promise.resolve()
			expect(loaded).toBe(false)

			hydrated()
			await loading
			expect(loaded).toBe(true)
		})

		it('does not wait for the user hydration on a public route', async () => {
			const sut = makeHook(mockAuth, { ready: new Promise<void>(() => {}) })

			await expect(
				sut.canLoad({}, {}, makeRouteNode({ auth: false }), null),
			).resolves.toBe(true)
		})

		it('allows authenticated users on protected routes', async () => {
			const sut = makeHook(mockAuth)
			const result = await sut.canLoad({}, {}, makeRouteNode({}), null)
			expect(result).toBe(true)
		})

		it('allows a guest free roam on application routes (soft gate, no redirect)', async () => {
			const sut = makeHook(createMockAuth({ isAuthenticated: false }))
			const result = await sut.canLoad({}, {}, makeRouteNode({}), null)
			// Guest with zero follows still reaches e.g. the dashboard; the empty
			// state is rendered in-page rather than blocked by a guard redirect.
			expect(result).toBe(true)
		})

		it('allows a guest on the dashboard route (reachable at any onboarding state)', async () => {
			const sut = makeHook(createMockAuth({ isAuthenticated: false }))
			const result = await sut.canLoad({}, {}, makeRouteNode({}), null)
			expect(result).toBe(true)
		})

		it('allows route with no data property', async () => {
			const sut = makeHook(mockAuth)
			const result = await sut.canLoad({}, {}, makeRouteNode(undefined), null)
			expect(result).toBe(true)
		})

		it('awaits authService.ready before checking auth on a protected route', async () => {
			let resolveReady: () => void
			const readyPromise = new Promise<void>((r) => {
				resolveReady = r
			})
			const sut = makeHook(
				createMockAuth({ isAuthenticated: true, ready: readyPromise }),
			)

			const canLoadPromise = sut.canLoad({}, {}, makeRouteNode({}), null)
			let resolved = false
			canLoadPromise.then(() => {
				resolved = true
			})
			await Promise.resolve()
			expect(resolved).toBe(false)

			resolveReady!()
			expect(await canLoadPromise).toBe(true)
		})
	})
})
