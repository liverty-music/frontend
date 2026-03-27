import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockI18n } from '../helpers/mock-i18n'
import { createMockRouter } from '../helpers/mock-router'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIConcertService = DI.createInterface('IConcertService')
const mockIGuestService = DI.createInterface('IGuestService')

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
}))

vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
}))

vi.mock('../../src/services/guest-service', () => ({
	IGuestService: mockIGuestService,
}))

vi.mock('../../src/constants/preview-artists', () => ({
	PREVIEW_ARTIST_IDS: ['a1', 'a2'],
	PREVIEW_ARTIST_NAME_MAP: new Map([
		['a1', 'Artist A'],
		['a2', 'Artist B'],
	]),
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS: 1,
}))

const { WelcomeRoute } = await import('../../src/routes/welcome/welcome-route')

describe('WelcomeRoute', () => {
	let sut: InstanceType<typeof WelcomeRoute>
	let mockAuth: {
		isAuthenticated: boolean
		ready: Promise<void>
		signIn: ReturnType<typeof vi.fn>
	}
	let mockOnboarding: {
		isOnboarding: boolean
		currentStep: string
		getRouteForCurrentStep: ReturnType<typeof vi.fn>
		reset: ReturnType<typeof vi.fn>
		setStep: ReturnType<typeof vi.fn>
	}
	let mockConcert: {
		listWithProximity: ReturnType<typeof vi.fn>
		toDateGroups: ReturnType<typeof vi.fn>
	}
	let mockGuest: { clearAll: ReturnType<typeof vi.fn> }
	let mockRouter: ReturnType<typeof createMockRouter>

	beforeEach(() => {
		mockAuth = {
			isAuthenticated: false,
			ready: Promise.resolve(),
			signIn: vi.fn(),
		}
		mockOnboarding = {
			isOnboarding: false,
			currentStep: 'lp',
			getRouteForCurrentStep: vi.fn().mockReturnValue(null),
			reset: vi.fn(),
			setStep: vi.fn(),
		}
		mockConcert = {
			listWithProximity: vi.fn().mockResolvedValue([]),
			toDateGroups: vi.fn().mockReturnValue([]),
		}
		mockGuest = { clearAll: vi.fn() }
		mockRouter = createMockRouter()

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIConcertService, mockConcert),
			Registration.instance(mockIGuestService, mockGuest),
			Registration.instance(IRouter, mockRouter),
			Registration.instance(IEventAggregator, {
				publish: vi.fn(),
				subscribe: vi.fn(() => ({ dispose: vi.fn() })),
			}),
			Registration.instance(I18N, createMockI18n()),
		)
		container.register(WelcomeRoute)
		sut = container.get(WelcomeRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('canLoad', () => {
		it('redirects authenticated user to dashboard', async () => {
			mockAuth.isAuthenticated = true
			const result = await sut.canLoad()
			expect(result).toBe('dashboard')
		})

		it('allows unauthenticated user', async () => {
			const result = await sut.canLoad()
			expect(result).toBe(true)
		})

		it('resumes onboarding for active onboarding user', async () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.getRouteForCurrentStep.mockReturnValue('discovery')

			const result = await sut.canLoad()
			expect(result).toBe('discovery')
		})
	})

	describe('handleGetStarted', () => {
		it('clears guest data, resets onboarding, and navigates to discovery', async () => {
			await sut.handleGetStarted()

			expect(mockGuest.clearAll).toHaveBeenCalledOnce()
			expect(mockOnboarding.reset).toHaveBeenCalledOnce()
			expect(mockOnboarding.setStep).toHaveBeenCalledWith('discovery')
			expect(mockRouter.load).toHaveBeenCalledWith('discovery')
		})
	})

	describe('handleLogin', () => {
		it('delegates to authService.signIn', async () => {
			await sut.handleLogin()
			expect(mockAuth.signIn).toHaveBeenCalledOnce()
		})
	})

	describe('detaching', () => {
		it('aborts the preview data controller', () => {
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

			// Trigger attached to create abort controller
			sut.attached()
			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
			abortSpy.mockRestore()
		})
	})
})
