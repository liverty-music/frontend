import type { RouteNode } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'
import { createMockToastService } from '../helpers/mock-toast'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIToastService = DI.createInterface('IToastService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
}))

const { AuthHook } = await import('../../src/hooks/auth-hook')

function makeRouteNode(data?: Record<string, unknown>): RouteNode {
	return { data } as unknown as RouteNode
}

describe('AuthHook', () => {
	let sut: InstanceType<typeof AuthHook>
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockToast: ReturnType<typeof createMockToastService>

	beforeEach(() => {
		mockAuth = createMockAuth({ isAuthenticated: true })
		mockToast = createMockToastService()

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIToastService, mockToast),
		)
		container.register(AuthHook)
		sut = container.get(AuthHook)
	})

	describe('canLoad', () => {
		it('should allow public routes without auth check', async () => {
			const next = makeRouteNode({ auth: false })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
		})

		it('should allow authenticated users on protected routes', async () => {
			const next = makeRouteNode({})
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
		})

		it('should redirect unauthenticated users to welcome', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(mockIToastService, mockToast),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			const next = makeRouteNode({})
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('')
			expect(mockToast.show).toHaveBeenCalledWith(
				'ログインが必要です',
				'warning',
			)
		})

		it('should await authService.ready before checking auth', async () => {
			let resolveReady: () => void
			const readyPromise = new Promise<void>((r) => {
				resolveReady = r
			})

			mockAuth = createMockAuth({
				isAuthenticated: true,
				ready: readyPromise,
			})
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(mockIToastService, mockToast),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			const next = makeRouteNode({})
			const canLoadPromise = sut.canLoad({}, {}, next, null)

			// Should not have resolved yet
			let resolved = false
			canLoadPromise.then(() => {
				resolved = true
			})
			await Promise.resolve() // flush microtasks
			expect(resolved).toBe(false)

			// Now resolve ready
			resolveReady!()
			const result = await canLoadPromise
			expect(result).toBe(true)
		})

		it('should allow route with no data property', async () => {
			const next = makeRouteNode(undefined)
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
		})
	})
})
