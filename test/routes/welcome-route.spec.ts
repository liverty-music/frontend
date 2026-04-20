import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { DI, IEventAggregator, INode, Registration } from 'aurelia'
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
	let host: HTMLElement

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
		host = document.createElement('div')

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
			Registration.instance(INode, host),
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
		it('resets onboarding and navigates to discovery without clearing guest data', async () => {
			await sut.handleGetStarted()

			// Guest data (follows/home) MUST be preserved so that users who
			// tapped Get Started after already having followed artists as a
			// guest don't lose their work. Spec: landing-page > Get Started
			// initiates onboarding without clearing guest data.
			expect(mockGuest.clearAll).not.toHaveBeenCalled()
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

		it('clears guest data before initiating sign-in to prevent stale guest.home from leaking into the auth-callback signup heuristic', async () => {
			await sut.handleLogin()

			expect(mockGuest.clearAll).toHaveBeenCalledOnce()
			expect(mockAuth.signIn).toHaveBeenCalledOnce()
			// Order matters: clearAll MUST happen before signIn so the OIDC
			// redirect leaves no stale guest state behind.
			expect(mockGuest.clearAll.mock.invocationCallOrder[0]).toBeLessThan(
				mockAuth.signIn.mock.invocationCallOrder[0],
			)
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

	describe('scrollToPreview', () => {
		let screen2: HTMLElement
		let scrollIntoViewSpy: ReturnType<typeof vi.fn>
		let matchMediaSpy: ReturnType<typeof vi.spyOn> | null

		beforeEach(() => {
			screen2 = document.createElement('section')
			screen2.className = 'welcome-screen-2'
			scrollIntoViewSpy = vi.fn()
			screen2.scrollIntoView = scrollIntoViewSpy
			host.appendChild(screen2)
			matchMediaSpy = null
		})

		afterEach(() => {
			matchMediaSpy?.mockRestore()
		})

		it('calls scrollIntoView with smooth behavior when reduced-motion is not set', () => {
			matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
				(query: string) =>
					({
						matches: false,
						media: query,
						onchange: null,
						addListener: vi.fn(),
						removeListener: vi.fn(),
						addEventListener: vi.fn(),
						removeEventListener: vi.fn(),
						dispatchEvent: vi.fn(),
					}) as unknown as MediaQueryList,
			)

			sut.scrollToPreview()

			expect(scrollIntoViewSpy).toHaveBeenCalledOnce()
			expect(scrollIntoViewSpy).toHaveBeenCalledWith({
				behavior: 'smooth',
				block: 'start',
			})
		})

		it('uses auto behavior when prefers-reduced-motion is set', () => {
			matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation(
				(query: string) =>
					({
						matches: query === '(prefers-reduced-motion: reduce)',
						media: query,
						onchange: null,
						addListener: vi.fn(),
						removeListener: vi.fn(),
						addEventListener: vi.fn(),
						removeEventListener: vi.fn(),
						dispatchEvent: vi.fn(),
					}) as unknown as MediaQueryList,
			)

			sut.scrollToPreview()

			expect(scrollIntoViewSpy).toHaveBeenCalledWith({
				behavior: 'auto',
				block: 'start',
			})
		})

		it('is a no-op when the preview section is not rendered', () => {
			// Remove the preview section to simulate the empty-preview state
			// (dateGroups.length === 0 — Screen 2 is excluded by if.bind).
			host.removeChild(screen2)

			sut.scrollToPreview()

			expect(scrollIntoViewSpy).not.toHaveBeenCalled()
		})
	})
})
