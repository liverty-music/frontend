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
const mockITicketJourneyStore = DI.createInterface('ITicketJourneyStore')
const mockIResumeRevalidator = DI.createInterface('IResumeRevalidator')
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
vi.mock('../../src/services/ticket-journey-store', () => ({
	ITicketJourneyStore: mockITicketJourneyStore,
}))
vi.mock('../../src/services/resume-revalidator', () => ({
	IResumeRevalidator: mockIResumeRevalidator,
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
		revalidateFollower: vi.fn().mockResolvedValue([]),
		peekDateGroups: vi.fn().mockReturnValue(null),
		setDateGroups: vi.fn(),
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

function makeJourneyStore() {
	return {
		journeyMap: new Map(),
		load: vi.fn().mockResolvedValue(new Map()),
		statusFor: vi.fn().mockReturnValue(undefined),
	}
}

function makeResumeRevalidator() {
	return {
		register: vi.fn(),
		unregister: vi.fn(),
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
	let mockJourney: ReturnType<typeof makeJourneyStore>
	let mockResume: ReturnType<typeof makeResumeRevalidator>
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
			Registration.instance(mockITicketJourneyStore, mockJourney),
			Registration.instance(mockIResumeRevalidator, mockResume),
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
		mockJourney = makeJourneyStore()
		mockResume = makeResumeRevalidator()
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

		it('is non-blocking: resolves before the data fetch settles, isLoading true at attach', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: { countryCode: 'JP', level1: 'JP-13' } }
			// Fetch never resolves → the timetable would stay a spinner.
			mockConcert.listByFollower.mockReturnValue(new Promise(() => {}))
			sut = buildSut()

			await sut.loading()

			// loading() resolved without awaiting the fetch: region is computed and
			// the spinner is showing.
			expect(sut.needsRegion).toBe(false)
			expect(sut.isLoading).toBe(true)
		})
	})

	// ---- attached() ----

	describe('attached', () => {
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

		it('does not fire the celebration at attached() while the load is still in flight', () => {
			mockAuth.isAuthenticated = true
			mockStorage = createMockLocalStorage({
				[StorageKeys.postSignupShown]: 'pending',
			})
			// Fetch never resolves → timetable stays a spinner.
			mockConcert.listByFollower.mockReturnValue(new Promise(() => {}))
			sut = buildSut()
			sut.needsRegion = false

			void sut.loadData()
			sut.attached()

			// attached() ran over a still-loading timetable: no celebration over a spinner.
			expect(sut.isLoading).toBe(true)
			expect(sut.showCelebration).toBe(false)
		})
	})

	// ---- data-ready side effects (gated on observed data arrival) ----

	describe('data-ready side effects', () => {
		it('shows the post-signup celebration on observed data arrival, then opens the dialog on dismissal', async () => {
			mockAuth.isAuthenticated = true
			mockStorage = createMockLocalStorage({
				[StorageKeys.postSignupShown]: 'pending',
			})
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

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

		it('does not show postSignupDialog when flag is absent', async () => {
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showPostSignupDialog).toBe(false)
		})

		it('latches finish() on a meaningful first dashboard arrival (onboarding + follows + region set)', async () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 1
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		it('does not latch when onboarding is already completed', async () => {
			mockOnboarding = makeOnboarding(false)
			mockFollow.followedCount = 5
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does not latch on a zero-follow arrival', async () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 0
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does not latch while the timetable is still loading', () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 1
			mockConcert.listByFollower.mockReturnValue(new Promise(() => {}))
			sut = buildSut()
			sut.needsRegion = false

			void sut.loadData()

			expect(sut.isLoading).toBe(true)
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

	// ---- Mode toggle (My Timetable ↔ All Nearby) ----

	describe('mode toggle', () => {
		type ModeSwap = { id: string; labelKey: string; isOn?: () => boolean }
		const modeSwap = (): ModeSwap | undefined =>
			(sut as unknown as { buildFabActions(): ModeSwap[] })
				.buildFabActions()
				.find((a) => a.id === 'mode-swap')

		// @spec components/infrastructure/fan/web/route/dashboard "Default mode is My Timetable"
		it('starts on My Timetable on every load, with the toggle showing it selected', async () => {
			await sut.loading()
			expect(sut.viewMode).toBe('timetable')
			expect(sut.isAllNearby).toBe(false)
			// The toggle is not highlighted and offers the other mode.
			expect(modeSwap()?.isOn?.()).toBe(false)
			expect(modeSwap()?.labelKey).toBe('allNearby.modeToggle.allNearby')

			// A reload builds a fresh route instance, which starts over on My
			// Timetable even if the previous one had switched away.
			vi.spyOn(sut, 'loadAllNearby').mockResolvedValue()
			sut.switchMode('allNearby')
			const reloaded = buildSut()
			await reloaded.loading()
			expect(reloaded.viewMode).toBe('timetable')
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Mode-specific filters appear only in All Nearby"
		it('gates the area and date filters on All Nearby', async () => {
			vi.spyOn(sut, 'loadAllNearby').mockResolvedValue()
			expect(sut.isAllNearby).toBe(false)
			sut.switchMode('allNearby')
			expect(sut.isAllNearby).toBe(true)
			sut.switchMode('timetable')
			expect(sut.isAllNearby).toBe(false)

			// The template renders the filter row (area chip + date chip) and both
			// of their sheets only while `isAllNearby` holds.
			const { default: html } = await import(
				'../../src/routes/dashboard/dashboard-route.html?raw'
			)
			const doc = new DOMParser().parseFromString(
				`<body>${html}</body>`,
				'text/html',
			)
			const gated = [
				'.all-nearby-filters',
				'user-home-selector[component\\.ref="areaSelector"]',
				'date-range-sheet',
			].map((selector) => doc.querySelector(selector)?.getAttribute('if.bind'))
			expect(gated).toEqual(['isAllNearby', 'isAllNearby', 'isAllNearby'])
			expect(
				doc
					.querySelector('.all-nearby-filters')
					?.querySelectorAll('button.filter-chip'),
			).toHaveLength(2)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Switching modes replaces the concert list"
		it('loads All Nearby by location and date range, then reverts to the cached timetable', async () => {
			const timetable = [
				{ date: 'timetable' },
			] as unknown as typeof sut.dateGroups
			const nearby = [{ date: 'nearby' }] as unknown as typeof sut.dateGroups
			const proximityGroups = [{ key: 'p' }]
			const listByLocation = vi.fn().mockResolvedValue(proximityGroups)
			const toDateGroupsForLocation = vi.fn().mockReturnValue(nearby)
			Object.assign(mockConcert, { listByLocation, toDateGroupsForLocation })
			sut = buildSut()
			sut.dateGroups = timetable
			sut.selectedAreaCode = 'JP-13'
			const range = { from: '2026-10-01', to: '2026-10-07' }
			sut.allNearbyRange = range as unknown as typeof sut.allNearbyRange

			sut.switchMode('allNearby')
			await vi.waitFor(() => expect(sut.allNearbyDateGroups).toBe(nearby))
			expect(listByLocation).toHaveBeenCalledWith(
				expect.objectContaining({ adminArea: 'JP-13' }),
				range.from,
				range.to,
				expect.any(AbortSignal),
			)
			expect(toDateGroupsForLocation).toHaveBeenCalledWith(proximityGroups)

			const followerCalls = mockConcert.listByFollower.mock.calls.length
			sut.switchMode('timetable')
			expect(sut.isAllNearby).toBe(false)
			// My Timetable comes back from what it already had, not a refetch.
			expect(sut.dateGroups).toBe(timetable)
			expect(mockConcert.listByFollower).toHaveBeenCalledTimes(followerCalls)
		})
	})

	// ---- switchMode() ----

	describe('switchMode', () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Header title does not change with the mode"
		it('switches only the mode; the header title stays the route’s own', () => {
			vi.spyOn(sut, 'loadAllNearby').mockResolvedValue()

			sut.switchMode('allNearby')
			expect(sut.viewMode).toBe('allNearby')
			// The toggle names the other mode, so it reflects the new selection.
			expect(sut.swapLabelKey).toBe('allNearby.modeToggle.timetable')

			sut.switchMode('timetable')
			expect(sut.viewMode).toBe('timetable')
			expect(sut.swapLabelKey).toBe('allNearby.modeToggle.allNearby')

			// The dashboard owns no header title: the shell header shows the
			// route's configured `data.titleKey` in both modes.
			expect('modeTitleKey' in sut).toBe(false)
		})
	})

	describe('detaching', () => {
		it('aborts active request', () => {
			sut.loadData()
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
		})
	})
})
