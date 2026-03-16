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
		LP: 'lp',
		DISCOVERY: 'discovery',
		DASHBOARD: 'dashboard',
		DETAIL: 'detail',
		MY_ARTISTS: 'my-artists',
		COMPLETED: 'completed',
	},
	STEP_ROUTE_MAP: {
		lp: '',
		discovery: 'discovery',
		dashboard: 'dashboard',
		detail: 'dashboard',
		'my-artists': 'my-artists',
		completed: '',
	},
	STEP_ORDER: [
		'lp',
		'discovery',
		'dashboard',
		'detail',
		'my-artists',
		'completed',
	],
	stepIndex(step: string) {
		return [
			'lp',
			'discovery',
			'dashboard',
			'detail',
			'my-artists',
			'completed',
		].indexOf(step)
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
				currentStep: 'completed',
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
					currentStep: 'completed',
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
					currentStep: 'completed',
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

		it('should silently redirect onboarding user on route without onboardingStep data', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 'dashboard',
					isOnboarding: true,
					setStep: vi.fn(),
					complete: vi.fn(),
					getRouteForCurrentStep: () => 'dashboard',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// Tickets route has no onboardingStep data
			const next = makeRouteNode({})
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('dashboard')
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should redirect onboarding user when route onboardingStep exceeds currentStep', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 'discovery',
					isOnboarding: true,
					spotlightActive: false,
					setStep: vi.fn(),
					complete: vi.fn(),
					deactivateSpotlight: vi.fn(),
					getRouteForCurrentStep: () => 'discovery',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// Dashboard requires onboardingStep 'dashboard', but user is at 'discovery' without spotlight
			const next = makeRouteNode({ onboardingStep: 'dashboard' })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('discovery')
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
					currentStep: 'discovery',
					isOnboarding: true,
					spotlightActive: true,
					setStep: mockSetStep,
					complete: vi.fn(),
					deactivateSpotlight: mockDeactivate,
					getRouteForCurrentStep: () => 'discovery',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// Direct nav tap on Dashboard (onboardingStep: 'dashboard') while spotlight is active
			const next = makeRouteNode({ onboardingStep: 'dashboard' })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
			expect(mockDeactivate).toHaveBeenCalledTimes(1)
			expect(mockSetStep).toHaveBeenCalledWith('dashboard') // DASHBOARD
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should show toast for non-onboarding unauthenticated user on protected route', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 'completed',
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

		it('should allow public route with onboardingStep during active onboarding', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 'discovery',
					isOnboarding: true,
					spotlightActive: false,
					setStep: vi.fn(),
					complete: vi.fn(),
					deactivateSpotlight: vi.fn(),
					getRouteForCurrentStep: () => 'discovery',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// /discovery has { auth: false, onboardingStep: 'discovery' }
			const next = makeRouteNode({ auth: false, onboardingStep: 'discovery' })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe(true)
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should redirect to LP when public onboardingStep route accessed without active onboarding', async () => {
			mockAuth = createMockAuth({ isAuthenticated: false })
			mockEa = createMockEventAggregator()
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, mockEa),
				Registration.instance(mockIOnboardingService, {
					currentStep: 'lp',
					isOnboarding: false,
					setStep: vi.fn(),
					complete: vi.fn(),
					getRouteForCurrentStep: () => '',
				}),
			)
			container.register(AuthHook)
			sut = container.get(AuthHook)

			// /discovery has { auth: false, onboardingStep: 'discovery' } but no active onboarding
			const next = makeRouteNode({ auth: false, onboardingStep: 'discovery' })
			const result = await sut.canLoad({}, {}, next, null)

			expect(result).toBe('')
			expect(mockEa.publish).not.toHaveBeenCalled()
		})
	})
})
