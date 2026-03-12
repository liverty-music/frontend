import type { RouteNode } from '@aurelia/router'
import { DI, IEventAggregator, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'
import { createMockEventAggregator } from '../helpers/mock-toast'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIOnboardingService = DI.createInterface('IOnboardingService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
	OnboardingStep: {
		LP: 0,
		DISCOVER: 1,
		LOADING: 2,
		DASHBOARD: 3,
		DETAIL: 4,
		MY_ARTISTS: 5,
		SIGNUP: 6,
		COMPLETED: 7,
	},
	STEP_ROUTE_MAP: {
		0: '',
		1: 'discover',
		2: 'onboarding/loading',
		3: 'dashboard',
		4: 'dashboard',
		5: 'my-artists',
		6: '',
		7: '',
	},
}))

const { AuthHook } = await import('../../src/hooks/auth-hook')

function makeRouteNode(data?: Record<string, unknown>): RouteNode {
	return { data } as unknown as RouteNode
}

describe('AuthHook', () => {
	let sut: InstanceType<typeof AuthHook>
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockEa: ReturnType<typeof createMockEventAggregator>

	beforeEach(() => {
		mockAuth = createMockAuth({ isAuthenticated: true })
		mockEa = createMockEventAggregator()

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(mockIOnboardingService, {
				currentStep: 7,
				isOnboarding: false,
				setStep: vi.fn(),
				complete: vi.fn(),
			}),
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
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 7,
					isOnboarding: false,
					setStep: vi.fn(),
					complete: vi.fn(),
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			const next = makeRouteNode({})
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('')
			expect(mockEa.publish).toHaveBeenCalledWith(expect.any(Toast))
			expect(mockEa.published[0].message).toBe('auth.loginRequired')
			expect(mockEa.published[0].severity).toBe('warning')
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
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 7,
					isOnboarding: false,
					setStep: vi.fn(),
					complete: vi.fn(),
				}),
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

		it('should silently redirect onboarding user on route without tutorialStep', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 3,
					isOnboarding: true,
					setStep: vi.fn(),
					complete: vi.fn(),
					getRouteForCurrentStep: () => 'dashboard',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// Tickets route has no tutorialStep
			const next = makeRouteNode({})
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('dashboard')
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should redirect onboarding user when tutorialStep exceeds currentStep', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 1,
					isOnboarding: true,
					spotlightActive: false,
					setStep: vi.fn(),
					complete: vi.fn(),
					deactivateSpotlight: vi.fn(),
					getRouteForCurrentStep: () => 'discover',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// Dashboard requires tutorialStep 3, but user is at step 1 without spotlight
			const next = makeRouteNode({ tutorialStep: 3 })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('discover')
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should advance step when onboarding user taps Dashboard nav with spotlight active', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const mockSetStep = vi.fn()
			const mockDeactivate = vi.fn()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 1,
					isOnboarding: true,
					spotlightActive: true,
					setStep: mockSetStep,
					complete: vi.fn(),
					deactivateSpotlight: mockDeactivate,
					getRouteForCurrentStep: () => 'discover',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// Direct nav tap on Dashboard (tutorialStep: 3) while spotlight is active
			const next = makeRouteNode({ tutorialStep: 3 })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
			expect(mockDeactivate).toHaveBeenCalledTimes(1)
			expect(mockSetStep).toHaveBeenCalledWith(3) // DASHBOARD
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should show toast for non-onboarding unauthenticated user on protected route', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 7,
					isOnboarding: false,
					setStep: vi.fn(),
					complete: vi.fn(),
					getRouteForCurrentStep: () => '',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			const next = makeRouteNode({})
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('')
			expect(mockEa.publish).toHaveBeenCalledWith(expect.any(Toast))
			expect(mockEa.published[0].severity).toBe('warning')
		})

		it('should allow route with no data property', async () => {
			const next = makeRouteNode(undefined)
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
		})
	})
})
