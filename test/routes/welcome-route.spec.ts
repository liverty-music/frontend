import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { DI, IEventAggregator, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import type { createMockI18n } from '../helpers/mock-i18n'
import { createMockRouter } from '../helpers/mock-router'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIConcertStore = DI.createInterface('IConcertStore')
const mockIUserStore = DI.createInterface('IUserStore')
const mockIFollowStore = DI.createInterface('IFollowStore')

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

vi.mock('../../src/services/concert-store', () => ({
	IConcertStore: mockIConcertStore,
}))

vi.mock('../../src/services/user-store', () => ({
	IUserStore: mockIUserStore,
}))

vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))

vi.mock('../../src/constants/preview-artists', () => ({
	getPreviewArtistIds: () => ['a1', 'a2'],
	getPreviewArtistNameMap: () =>
		new Map([
			['a1', 'Artist A'],
			['a2', 'Artist B'],
		]),
	PREVIEW_MIN_ARTISTS_WITH_CONCERTS: 1,
	__resetPreviewArtistsForTests: () => {},
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
	let mockUserStore: {
		clearGuest: ReturnType<typeof vi.fn>
		currentLanguage: string
	}
	let mockFollowStore: { clearGuest: ReturnType<typeof vi.fn> }
	let mockI18n: ReturnType<typeof createMockI18n>
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
		// The language picker reads its checked state from UserStore's reactive
		// `currentLanguage` projection (no local @observable mirror). On selection
		// changeLocale's guest path calls i18n.setLocale then persists the choice
		// to the single `localStorage['language']` key — no store-owned guest key.
		mockUserStore = {
			clearGuest: vi.fn(),
			currentLanguage: 'ja',
		}
		mockFollowStore = { clearGuest: vi.fn() }
		mockRouter = createMockRouter()
		host = document.createElement('div')

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(mockIUserStore, mockUserStore),
			Registration.instance(mockIFollowStore, mockFollowStore),
			Registration.instance(IRouter, mockRouter),
			Registration.instance(IEventAggregator, {
				publish: vi.fn(),
				subscribe: vi.fn(() => ({ dispose: vi.fn() })),
			}),
			Registration.instance(INode, host),
		)
		container.register(WelcomeRoute)
		sut = container.get(WelcomeRoute)
		// createTestContainer pre-registers its own I18N mock and the first
		// instance registration for a key wins in Aurelia DI, so read back the
		// instance the route actually resolved rather than registering a second.
		mockI18n = container.get(I18N) as ReturnType<typeof createMockI18n>
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

		it('allows an onboarding user to view Welcome (no forced resume)', async () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.getRouteForCurrentStep.mockReturnValue('discovery')

			// Welcome is reachable during onboarding so users can re-read the value
			// proposition; viewing it must not bounce them back to their step.
			const result = await sut.canLoad()
			expect(result).toBe(true)
		})
	})

	describe('handleGetStarted', () => {
		it('resets onboarding and navigates to discovery without clearing guest data', async () => {
			await sut.handleGetStarted()

			// Guest data (follows/home) MUST be preserved so that users who
			// tapped Get Started after already having followed artists as a
			// guest don't lose their work. Spec: landing-page > Get Started
			// initiates onboarding without clearing guest data.
			expect(mockUserStore.clearGuest).not.toHaveBeenCalled()
			expect(mockFollowStore.clearGuest).not.toHaveBeenCalled()
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

			// Coordinated reset across the stores that own the guest slices,
			// replacing the old GuestService.clearAll().
			expect(mockUserStore.clearGuest).toHaveBeenCalledOnce()
			expect(mockFollowStore.clearGuest).toHaveBeenCalledOnce()
			expect(mockAuth.signIn).toHaveBeenCalledOnce()
			// Order matters: the reset MUST happen before signIn so the OIDC
			// redirect leaves no stale guest state behind.
			expect(mockUserStore.clearGuest.mock.invocationCallOrder[0]).toBeLessThan(
				mockAuth.signIn.mock.invocationCallOrder[0],
			)
		})
	})

	describe('language picker', () => {
		it('currentLocale projects UserStore.currentLanguage (no local mirror)', () => {
			mockUserStore.currentLanguage = 'en'
			expect(sut.currentLocale).toBe('en')

			// A change to the store's projection is reflected without any local
			// @observable mirror to keep in sync.
			mockUserStore.currentLanguage = 'ja'
			expect(sut.currentLocale).toBe('ja')
		})

		it('selectLanguage routes the guest locale change through changeLocale → i18n + single language key', async () => {
			localStorage.removeItem('language')
			// Active locale starts at 'ja' (mock i18n default); pick 'en'.
			await sut.selectLanguage('en')

			expect(mockI18n.setLocale).toHaveBeenCalledWith('en')
			// The anonymous choice is persisted to the single `language` key (the
			// i18next detector cache) — no separate guest.language key.
			expect(localStorage.getItem('language')).toBe('en')
			localStorage.removeItem('language')
		})

		it('selectLanguage is a no-op when the locale is unchanged', async () => {
			localStorage.removeItem('language')
			// Active locale is 'ja'; selecting 'ja' must not re-persist.
			await sut.selectLanguage('ja')

			expect(mockI18n.setLocale).not.toHaveBeenCalled()
			expect(localStorage.getItem('language')).toBeNull()
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
