import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageKeys } from '../../src/constants/storage-keys'
import { createTestContainer } from '../helpers/create-container'
import { createMockHistory } from '../helpers/mock-history'
import { createMockLocalStorage } from '../helpers/mock-local-storage'

// --- DI tokens (must be created before vi.mock calls) ---
const mockIAuthService = DI.createInterface('IAuthService')
const mockIConcertStore = DI.createInterface('IConcertStore')
const mockIFollowStore = DI.createInterface('IFollowStore')
const mockITicketJourneyService = DI.createInterface('ITicketJourneyService')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIUserStore = DI.createInterface('IUserStore')
const mockILocalStorage = DI.createInterface('ILocalStorage')
const mockIHistory = DI.createInterface('IHistory')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/concert-store', () => ({
	IConcertStore: mockIConcertStore,
}))
vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))
vi.mock('../../src/services/ticket-journey-service', () => ({
	ITicketJourneyService: mockITicketJourneyService,
}))
vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
}))
vi.mock('../../src/services/user-store', () => ({
	IUserStore: mockIUserStore,
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

function makeOnboarding(isOnboarding = false) {
	return {
		isOnboarding,
		isCompleted: !isOnboarding,
		finish: vi.fn(),
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
		followedCount: 0,
	}
}

function makeJourneyService() {
	return {
		listByUser: vi.fn().mockResolvedValue(new Map()),
	}
}

// UserStore is the single owner of the User entity (authenticated `current`,
// read for the needsRegion check) AND the guest home write path (setGuestHome)
// the dashboard calls for unauthenticated users.
function makeUserStore() {
	return {
		current: undefined as { home: unknown } | undefined,
		guestHome: null as string | null,
		setGuestHome: vi.fn(),
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
	let mockUserStore: ReturnType<typeof makeUserStore>
	// Alias to the merged store so the existing `mockUser.current` assertions
	// read naturally against the one IUserStore the route now injects.
	let mockUser: typeof mockUserStore
	let mockStorage: ReturnType<typeof createMockLocalStorage>
	let mockHistory: ReturnType<typeof createMockHistory>

	function buildSut() {
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(mockIFollowStore, mockFollow),
			Registration.instance(mockITicketJourneyService, mockJourney),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIUserStore, mockUserStore),
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
		mockUserStore = makeUserStore()
		mockUser = mockUserStore
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
		it('shows the post-signup celebration then opens the dialog on dismissal', () => {
			mockAuth.isAuthenticated = true
			mockStorage = createMockLocalStorage({
				[StorageKeys.postSignupShown]: 'pending',
			})
			sut = buildSut()

			sut.attached()

			// Emotion first: confetti celebration; dialog deferred until dismissal.
			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(true)
			expect(mockStorage.removeItem).toHaveBeenCalledWith(
				StorageKeys.postSignupShown,
			)
			expect(sut.showPostSignupDialog).toBe(false)

			sut.onCelebrationDismissed()

			expect(sut.showPostSignupDialog).toBe(true)
		})

		it('does not show postSignupDialog when flag is absent', () => {
			sut.attached()
			expect(sut.showPostSignupDialog).toBe(false)
		})

		it('opens home selector when needsRegion is true', () => {
			sut.needsRegion = true
			const mockHomeSelector = { open: vi.fn() }
			sut.homeSelector = mockHomeSelector as never

			sut.attached()

			expect(mockHomeSelector.open).toHaveBeenCalledOnce()
		})

		it('does not open home selector when needsRegion is false', () => {
			sut.needsRegion = false
			const mockHomeSelector = { open: vi.fn() }
			sut.homeSelector = mockHomeSelector as never

			sut.attached()

			expect(mockHomeSelector.open).not.toHaveBeenCalled()
		})

		it('latches finish() on a meaningful first dashboard arrival (onboarding + follows + region set)', () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 1
			sut = buildSut()
			sut.needsRegion = false

			sut.attached()

			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		it('does not latch when onboarding is already completed', () => {
			mockOnboarding = makeOnboarding(false)
			mockFollow.followedCount = 5
			sut = buildSut()
			sut.needsRegion = false

			sut.attached()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does not latch on a zero-follow arrival', () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 0
			sut = buildSut()
			sut.needsRegion = false

			sut.attached()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
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

		it('calls userStore.setGuestHome for unauthenticated user', () => {
			mockAuth.isAuthenticated = false
			sut = buildSut()

			sut.onHomeSelected('JP-13')

			expect(mockUserStore.setGuestHome).toHaveBeenCalledWith('JP-13')
		})

		it('does not call userStore.setGuestHome for authenticated user', () => {
			mockAuth.isAuthenticated = true
			sut = buildSut()

			sut.onHomeSelected('JP-13')

			expect(mockUserStore.setGuestHome).not.toHaveBeenCalled()
		})
	})

	// ---- detaching ----

	describe('detaching', () => {
		it('aborts active request', () => {
			sut.loadData()
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
		})
	})
})
