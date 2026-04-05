import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageKeys } from '../../src/constants/storage-keys'
import { createTestContainer } from '../helpers/create-container'
import { createMockHistory } from '../helpers/mock-history'
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
const mockIHistory = DI.createInterface('IHistory')

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
vi.mock('../../src/adapter/browser/history', () => ({
	IHistory: mockIHistory,
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

function makeJourneyService() {
	return {
		listByUser: vi.fn().mockResolvedValue(new Map()),
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
	let mockHistory: ReturnType<typeof createMockHistory>

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
			Registration.instance(mockIHistory, mockHistory),
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
		mockHistory = createMockHistory()
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
	})

	// ---- onHomeSelected() ----

	describe('onHomeSelected', () => {
		it('sets needsRegion=false and triggers loadData', () => {
			sut.needsRegion = true
			const loadSpy = vi.spyOn(sut, 'loadData').mockResolvedValue()

			sut.onHomeSelected('JP-13')

			expect(sut.needsRegion).toBe(false)
			expect(loadSpy).toHaveBeenCalledOnce()
		})

		it('calls guest.setHome for unauthenticated user', () => {
			mockAuth.isAuthenticated = false
			sut = buildSut()

			sut.onHomeSelected('JP-13')

			expect(mockGuest.setHome).toHaveBeenCalledWith('JP-13')
		})

		it('does not call guest.setHome for authenticated user', () => {
			mockAuth.isAuthenticated = true
			sut = buildSut()

			sut.onHomeSelected('JP-13')

			expect(mockGuest.setHome).not.toHaveBeenCalled()
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
})
