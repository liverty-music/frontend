import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageKeys } from '../../src/constants/storage-keys'
import { createTestContainer } from '../helpers/create-container'
import { createMockLocalStorage } from '../helpers/mock-local-storage'
import { createMockNavDimmingService } from '../helpers/mock-nav-dimming-service'

// --- DI tokens (must be created before vi.mock calls) ---
const mockIAuthService = DI.createInterface('IAuthService')
const mockIConcertService = DI.createInterface('IConcertService')
const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockITicketJourneyService = DI.createInterface('ITicketJourneyService')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIGuestService = DI.createInterface('IGuestService')
const mockIUserService = DI.createInterface('IUserService')
const mockINavDimmingService = DI.createInterface('INavDimmingService')
const mockILocalStorage = DI.createInterface('ILocalStorage')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
}))
vi.mock('../../src/services/follow-service-client', () => ({
	IFollowServiceClient: mockIFollowServiceClient,
}))
vi.mock('../../src/services/ticket-journey-service', () => ({
	ITicketJourneyService: mockITicketJourneyService,
}))
vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
	OnboardingStep: {
		LP: 'lp',
		DISCOVERY: 'discovery',
		DASHBOARD: 'dashboard',
		MY_ARTISTS: 'my-artists',
		COMPLETED: 'completed',
	},
}))
vi.mock('../../src/services/guest-service', () => ({
	IGuestService: mockIGuestService,
}))
vi.mock('../../src/services/user-service', () => ({
	IUserService: mockIUserService,
}))
vi.mock('../../src/services/nav-dimming-service', () => ({
	INavDimmingService: mockINavDimmingService,
}))
vi.mock('../../src/adapter/storage/local-storage', () => ({
	ILocalStorage: mockILocalStorage,
}))
vi.mock('../../src/components/user-home-selector/user-home-selector', () => ({
	UserHomeSelector: {
		getStoredHome: vi.fn().mockReturnValue(null),
	},
}))

const { DashboardRoute } = await import(
	'../../src/routes/dashboard/dashboard-route'
)
const { UserHomeSelector } = await import(
	'../../src/components/user-home-selector/user-home-selector'
)

// ---- Factory helpers ----

function makeOnboarding(step = 'completed') {
	return {
		currentStep: step,
		isOnboarding: step !== 'completed',
		isCompleted: step === 'completed',
		activateSpotlight: vi.fn(),
		deactivateSpotlight: vi.fn(),
		setStep: vi.fn(),
	}
}

function makeConcertService() {
	return {
		listByFollower: vi.fn().mockResolvedValue([]),
		toDateGroups: vi.fn().mockReturnValue([]),
		listConcerts: vi.fn().mockResolvedValue([]),
	}
}

function makeFollowService() {
	return {
		getFollowedArtistMap: vi.fn().mockResolvedValue(new Map()),
		listFollowed: vi.fn().mockResolvedValue([]),
	}
}

function makeJourneyService(authenticated = false) {
	return {
		listByUser: authenticated
			? vi.fn().mockResolvedValue(new Map())
			: vi.fn().mockResolvedValue(new Map()),
	}
}

function makeGuestService() {
	return {
		home: null as string | null,
		setHome: vi.fn(),
	}
}

// ---- Suite ----

describe('DashboardRoute', () => {
	let sut: InstanceType<typeof DashboardRoute>
	let mockAuth: { isAuthenticated: boolean; signUp: ReturnType<typeof vi.fn> }
	let mockConcert: ReturnType<typeof makeConcertService>
	let mockFollow: ReturnType<typeof makeFollowService>
	let mockJourney: ReturnType<typeof makeJourneyService>
	let mockOnboarding: ReturnType<typeof makeOnboarding>
	let mockGuest: ReturnType<typeof makeGuestService>
	let mockUser: { current: { home: unknown } | undefined }
	let mockNavDimming: ReturnType<typeof createMockNavDimmingService>
	let mockStorage: ReturnType<typeof createMockLocalStorage>

	function buildSut() {
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIConcertService, mockConcert),
			Registration.instance(mockIFollowServiceClient, mockFollow),
			Registration.instance(mockITicketJourneyService, mockJourney),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIGuestService, mockGuest),
			Registration.instance(mockIUserService, mockUser),
			Registration.instance(mockINavDimmingService, mockNavDimming),
			Registration.instance(mockILocalStorage, mockStorage),
		)
		container.register(DashboardRoute)
		return container.get(DashboardRoute)
	}

	beforeEach(() => {
		vi.useFakeTimers()

		mockAuth = { isAuthenticated: false, signUp: vi.fn() }
		mockConcert = makeConcertService()
		mockFollow = makeFollowService()
		mockJourney = makeJourneyService()
		mockOnboarding = makeOnboarding()
		mockGuest = makeGuestService()
		mockUser = { current: undefined }
		mockNavDimming = createMockNavDimmingService()
		mockStorage = createMockLocalStorage()
		;(
			UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
		).mockReturnValue(null)

		sut = buildSut()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	// ---- loading() ----

	describe('loading', () => {
		it('sets needsRegion=true for unauthenticated user without stored home', async () => {
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue(null)

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('sets needsRegion=false for unauthenticated user with stored home', async () => {
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue('JP-13')

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('sets needsRegion=true for authenticated user without home', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: undefined }

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('sets needsRegion=false for authenticated user with home', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: { countryCode: 'JP', level1: 'JP-13' } }

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('sets showSignupBanner for unauthenticated completed-onboarding user', async () => {
			mockOnboarding = makeOnboarding('completed')
			;(mockOnboarding as { isCompleted: boolean }).isCompleted = true
			sut = buildSut()

			await sut.loading()

			expect(sut.showSignupBanner).toBe(true)
		})

		it('does not set showSignupBanner for authenticated user', async () => {
			mockAuth.isAuthenticated = true
			await sut.loading()
			expect(sut.showSignupBanner).toBe(false)
		})
	})

	// ---- attached() ----

	describe('attached', () => {
		it('shows postSignupDialog when storage flag is pending', () => {
			mockStorage = createMockLocalStorage({
				[StorageKeys.postSignupShown]: 'pending',
			})
			sut = buildSut()

			sut.attached()

			expect(sut.showPostSignupDialog).toBe(true)
			expect(mockStorage.removeItem).toHaveBeenCalledWith(
				StorageKeys.postSignupShown,
			)
		})

		it('does not show postSignupDialog when flag is absent', () => {
			sut.attached()
			expect(sut.showPostSignupDialog).toBe(false)
		})

		it('enters waiting-for-home when on DASHBOARD step with needsRegion', () => {
			mockOnboarding = makeOnboarding('dashboard')
			sut = buildSut()
			sut.needsRegion = true

			sut.attached()

			expect(sut.laneIntroPhase).toBe('waiting-for-home')
			expect(mockNavDimming.setDimmed).toHaveBeenCalledWith(true)
		})

		it('does not start lane intro when not on DASHBOARD step', () => {
			mockOnboarding = makeOnboarding('completed')
			sut = buildSut()

			sut.attached()

			expect(sut.laneIntroPhase).toBe('done')
			expect(mockNavDimming.setDimmed).not.toHaveBeenCalled()
		})
	})

	// ---- Lane intro state machine ----

	describe('lane intro state machine', () => {
		beforeEach(() => {
			mockOnboarding = makeOnboarding('dashboard')
			mockGuest.home = 'JP-13'
			sut = buildSut()
			sut.needsRegion = false
			// Provide concert data so lane intro is not skipped
			sut.dateGroups = [
				{
					label: 'Mar 15',
					dateKey: '2026-03-15',
					home: [],
					near: [],
					away: [],
				} as never,
			]
		})

		it('starts at home phase when region is already set', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.laneIntroPhase).toBe('home')
			expect(mockNavDimming.setDimmed).toHaveBeenCalledWith(true)
		})

		it('activates spotlight for home stage on start', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(mockOnboarding.activateSpotlight).toHaveBeenCalledWith(
				'concert-highway [data-stage="home"]',
				expect.any(String),
				expect.any(Function),
			)
		})

		it('advances home → near on tap', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			sut.onLaneIntroTap()

			expect(sut.laneIntroPhase).toBe('near')
		})

		it('advances near → away on tap', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)
			sut.onLaneIntroTap() // home → near

			sut.onLaneIntroTap() // near → away

			expect(sut.laneIntroPhase).toBe('away')
		})

		it('away tap triggers completeLaneIntro → done', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)
			sut.onLaneIntroTap() // home → near
			sut.onLaneIntroTap() // near → away

			sut.onLaneIntroTap() // away → done

			expect(sut.laneIntroPhase).toBe('done')
		})

		it('completeLaneIntro shows celebration when not yet shown', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)
			sut.onLaneIntroTap()
			sut.onLaneIntroTap()
			sut.onLaneIntroTap()

			expect(sut.showCelebration).toBe(true)
			expect(mockStorage.setItem).toHaveBeenCalledWith(
				StorageKeys.celebrationShown,
				'1',
			)
		})

		it('completeLaneIntro undims nav when celebration already shown', async () => {
			mockStorage = createMockLocalStorage({
				[StorageKeys.celebrationShown]: '1',
			})
			sut = buildSut()
			sut.needsRegion = false
			sut.dateGroups = [
				{
					label: 'x',
					dateKey: '2026-03-15',
					home: [],
					near: [],
					away: [],
				} as never,
			]
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			sut.onLaneIntroTap()
			sut.onLaneIntroTap()
			sut.onLaneIntroTap()

			expect(sut.showCelebration).toBe(false)
			expect(mockNavDimming.setDimmed).toHaveBeenLastCalledWith(false)
		})

		it('skips lane intro and shows celebration when no concert data', async () => {
			sut.dateGroups = []
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.laneIntroPhase).toBe('done')
			expect(sut.showCelebration).toBe(true)
		})

		it('does not replay celebration when already shown and no concert data', async () => {
			mockStorage = createMockLocalStorage({
				[StorageKeys.celebrationShown]: '1',
			})
			sut = buildSut()
			sut.dateGroups = []
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.showCelebration).toBe(false)
		})

		it('does not advance from waiting-for-home on tap', () => {
			sut.needsRegion = true
			sut.attached()

			sut.onLaneIntroTap()

			expect(sut.laneIntroPhase).toBe('waiting-for-home')
		})
	})

	// ---- onCelebrationDismissed ----

	describe('onCelebrationDismissed', () => {
		it('clears showCelebration, undims nav, deactivates spotlight', () => {
			sut.showCelebration = true

			sut.onCelebrationDismissed()

			expect(sut.showCelebration).toBe(false)
			expect(mockNavDimming.setDimmed).toHaveBeenCalledWith(false)
			expect(mockOnboarding.deactivateSpotlight).toHaveBeenCalled()
		})
	})

	// ---- detaching ----

	describe('detaching', () => {
		it('aborts active request and undims nav', () => {
			sut.loadData()
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
			expect(mockNavDimming.setDimmed).toHaveBeenCalledWith(false)
		})
	})

	// ---- INavDimmingService delegation ----

	describe('INavDimmingService delegation', () => {
		it('does NOT directly query [data-nav] DOM elements', () => {
			// This test verifies that the component does not contain a querySelectorAll call
			// by checking that setDimmed on the service is the only mechanism called.
			const querySpy = vi.spyOn(document, 'querySelectorAll')

			mockOnboarding = makeOnboarding('dashboard')
			sut = buildSut()
			sut.dateGroups = [
				{ label: 'x', dateKey: 'x', home: [], near: [], away: [] } as never,
			]
			sut.attached()

			// querySelectorAll should NOT be called by the route itself
			const navQueries = (querySpy.mock.calls as [string][]).filter(
				([sel]) => sel === '[data-nav]',
			)
			expect(navQueries).toHaveLength(0)
		})
	})
})
