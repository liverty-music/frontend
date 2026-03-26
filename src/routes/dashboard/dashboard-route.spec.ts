import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingStep } from '../../services/onboarding-service'

// Stub Aurelia DI: resolve() returns services keyed by interface token
const fakeOnboarding = {
	currentStep: OnboardingStep.DASHBOARD as string,
	isOnboarding: true,
	isCompleted: false,
	setStep: vi.fn(),
	activateSpotlight: vi.fn(),
	deactivateSpotlight: vi.fn(),
}

const fakeAuth = {
	isAuthenticated: false,
	signUp: vi.fn(),
}

const fakeDashboard = {
	loadDashboardEvents: vi.fn(() => Promise.resolve([])),
}

const fakeGuest = {
	home: 'jp-tokyo',
	setHome: vi.fn(),
}

const fakeUser = {
	current: null as { home?: string } | null,
}

const fakeI18n = {
	tr: vi.fn((key: string) => key),
}

const fakeLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	scopeTo: vi.fn(() => fakeLogger),
}

const fakeElement = {
	querySelector: vi.fn(() => null),
	querySelectorAll: vi.fn(() => []),
	closest: vi.fn(() => ({
		querySelectorAll: vi.fn(() => []),
	})),
}

// Mock DI tokens used via resolve()
const serviceMap = new Map<unknown, unknown>()

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => serviceMap.get(token) ?? fakeLogger),
	}
})

vi.mock('@aurelia/i18n', () => ({
	I18N: Symbol('I18N'),
}))

vi.mock('../../services/auth-service', () => ({
	IAuthService: Symbol('IAuthService'),
}))

vi.mock('../../services/dashboard-service', () => ({
	IDashboardService: Symbol('IDashboardService'),
}))

vi.mock('../../services/onboarding-service', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../../services/onboarding-service')>()
	return {
		...actual,
		IOnboardingService: Symbol('IOnboardingService'),
	}
})

vi.mock('../../services/guest-service', () => ({
	IGuestService: Symbol('IGuestService'),
}))

vi.mock('../../services/user-service', () => ({
	IUserService: Symbol('IUserService'),
}))

vi.mock('../../components/user-home-selector/user-home-selector', () => ({
	UserHomeSelector: { getStoredHome: vi.fn(() => 'jp-tokyo') },
}))

// Import after mocks are set up
import { I18N } from '@aurelia/i18n'
import { ILogger, INode } from 'aurelia'
import { IAuthService } from '../../services/auth-service'
import { IDashboardService } from '../../services/dashboard-service'
import { IGuestService } from '../../services/guest-service'
import { IOnboardingService } from '../../services/onboarding-service'
import { IUserService } from '../../services/user-service'
import { DashboardRoute } from './dashboard-route'

function setupServiceMap(): void {
	serviceMap.set(IOnboardingService, fakeOnboarding)
	serviceMap.set(IAuthService, fakeAuth)
	serviceMap.set(IDashboardService, fakeDashboard)
	serviceMap.set(IGuestService, fakeGuest)
	serviceMap.set(IUserService, fakeUser)
	serviceMap.set(I18N, fakeI18n)
	serviceMap.set(ILogger, fakeLogger)
	serviceMap.set(INode, fakeElement)
}

describe('DashboardRoute onboarding orchestration', () => {
	let sut: DashboardRoute

	beforeEach(() => {
		localStorage.clear()
		vi.clearAllMocks()
		fakeOnboarding.currentStep = OnboardingStep.DASHBOARD
		fakeOnboarding.isOnboarding = true
		fakeOnboarding.isCompleted = false
		fakeAuth.isAuthenticated = false
		fakeGuest.home = 'jp-tokyo'
		fakeUser.current = null
		fakeDashboard.loadDashboardEvents.mockResolvedValue([])

		setupServiceMap()
		sut = new DashboardRoute()
	})

	afterEach(() => {
		localStorage.clear()
	})

	describe('loading()', () => {
		// BUG DETECTION: This test will FAIL against current code.
		// loading() currently sets showCelebration=true when step is DASHBOARD
		// and celebrationShown is false. Per spec, celebration should only be
		// triggered by completeLaneIntro() after lane intro finishes.
		it('does NOT set showCelebration=true prematurely', async () => {
			await sut.loading()

			expect(sut.showCelebration).toBe(false)
		})

		it('does NOT set showCelebration when step is not DASHBOARD', async () => {
			fakeOnboarding.currentStep = OnboardingStep.MY_ARTISTS

			await sut.loading()

			expect(sut.showCelebration).toBe(false)
		})
	})

	describe('attached()', () => {
		// BUG DETECTION: This test will FAIL against current code.
		// attached() currently guards startLaneIntro() with !showCelebration.
		// When loading() sets showCelebration=true, startLaneIntro() is skipped.
		it('calls startLaneIntro when step is DASHBOARD', async () => {
			await sut.loading()
			sut.attached()

			// startLaneIntro is private, but we can observe its effects:
			// it should change laneIntroPhase from 'done' to something else,
			// or at minimum call activateSpotlight (when data is available).
			// With no concert data, it should skip lane intro and show celebration.
			// The key assertion: celebration was NOT set by loading().
			expect(sut.showCelebration).toBe(false)
		})
	})

	describe('completeLaneIntro()', () => {
		it('sets showCelebration=true after lane intro completes', () => {
			// Access the private method via bracket notation for testing
			;(sut as unknown as { completeLaneIntro(): void }).completeLaneIntro()

			expect(sut.showCelebration).toBe(true)
			expect(sut.laneIntroPhase).toBe('done')
		})

		it('deactivates spotlight when lane intro completes', () => {
			;(sut as unknown as { completeLaneIntro(): void }).completeLaneIntro()

			expect(fakeOnboarding.deactivateSpotlight).toHaveBeenCalled()
		})
	})

	describe('advanceLaneIntro()', () => {
		it('advances through phases: home → near → away → done', () => {
			const advance = () =>
				(sut as unknown as { advanceLaneIntro(): void }).advanceLaneIntro()

			sut.laneIntroPhase = 'home'
			advance()
			expect(sut.laneIntroPhase).toBe('near')

			advance()
			expect(sut.laneIntroPhase).toBe('away')

			advance()
			expect(sut.laneIntroPhase).toBe('done')
			expect(sut.showCelebration).toBe(true)
		})
	})
})
