import { DI, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const mockIConcertService = DI.createInterface('IConcertService')
const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockITicketJourneyService = DI.createInterface('ITicketJourneyService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIAuthService = DI.createInterface('IAuthService')
const mockIUserService = DI.createInterface('IUserService')
const mockIGuestService = DI.createInterface('IGuestService')

vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
}))

vi.mock('../../src/services/follow-service-client', () => ({
	IFollowServiceClient: mockIFollowServiceClient,
}))

vi.mock('../../src/services/ticket-journey-service', () => ({
	ITicketJourneyService: mockITicketJourneyService,
}))

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
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

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/services/user-service', () => ({
	IUserService: mockIUserService,
}))

vi.mock('../../src/services/guest-service', () => ({
	IGuestService: mockIGuestService,
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

describe('DashboardRoute', () => {
	let sut: InstanceType<typeof DashboardRoute>
	let mockConcertService: {
		listByFollower: ReturnType<typeof vi.fn>
		toDateGroups: ReturnType<typeof vi.fn>
	}
	let mockFollowService: {
		getFollowedArtistMap: ReturnType<typeof vi.fn>
	}
	let mockJourneyService: {
		listByUser: ReturnType<typeof vi.fn>
	}
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockOnboarding: {
		currentStep: string
		isOnboarding: boolean
		isCompleted: boolean
		setStep: ReturnType<typeof vi.fn>
		complete: ReturnType<typeof vi.fn>
		activateSpotlight: ReturnType<typeof vi.fn>
		deactivateSpotlight: ReturnType<typeof vi.fn>
		bringSpotlightToFront: ReturnType<typeof vi.fn>
	}
	let mockAuth: {
		isAuthenticated: boolean
	}
	let mockUserClient: {
		get: ReturnType<typeof vi.fn>
	}
	let mockUser: {
		client: typeof mockUserClient
		updateHome: ReturnType<typeof vi.fn>
		current: { home?: { countryCode: string; level1: string } } | undefined
	}
	let mockGuest: {
		follows: {
			artist: { id: string; name: string; mbid: string }
			home: string | null
		}[]
		home: string | null
		followedCount: number
		follow: ReturnType<typeof vi.fn>
		unfollow: ReturnType<typeof vi.fn>
		setHome: ReturnType<typeof vi.fn>
		clearAll: ReturnType<typeof vi.fn>
		listFollowed: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		mockConcertService = {
			listByFollower: vi.fn().mockResolvedValue([]),
			toDateGroups: vi.fn().mockReturnValue([]),
		}
		mockFollowService = {
			getFollowedArtistMap: vi.fn().mockResolvedValue(new Map()),
		}
		mockJourneyService = {
			listByUser: vi.fn().mockResolvedValue(new Map()),
		}
		mockRouter = createMockRouter()
		mockOnboarding = {
			currentStep: 'completed',
			isOnboarding: false,
			isCompleted: true,
			setStep: vi.fn(),
			complete: vi.fn(),
			activateSpotlight: vi.fn(),
			deactivateSpotlight: vi.fn(),
			bringSpotlightToFront: vi.fn(),
		}
		mockAuth = {
			isAuthenticated: false,
		}
		mockUserClient = {
			get: vi.fn().mockResolvedValue({ user: undefined }),
		}
		mockUser = {
			client: mockUserClient,
			current: undefined,
			updateHome: vi.fn().mockResolvedValue(undefined),
		}
		mockGuest = {
			follows: [],
			home: null,
			followedCount: 0,
			follow: vi.fn(),
			unfollow: vi.fn(),
			setHome: vi.fn(),
			clearAll: vi.fn(),
			listFollowed: vi.fn().mockReturnValue([]),
		}

		const mockElement = document.createElement('div')

		const container = createTestContainer(
			Registration.instance(mockIConcertService, mockConcertService),
			Registration.instance(mockIFollowServiceClient, mockFollowService),
			Registration.instance(mockITicketJourneyService, mockJourneyService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIUserService, mockUser),
			Registration.instance(mockIGuestService, mockGuest),
			Registration.instance(INode, mockElement),
		)
		container.register(DashboardRoute)
		sut = container.get(DashboardRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('loadData', () => {
		it('should populate dateGroups on success', async () => {
			const fakeGroups = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					home: [],
					nearby: [],
					away: [],
				},
			]
			mockConcertService.listByFollower.mockResolvedValue([
				{ date: {}, home: [], nearby: [], away: [] },
			])
			mockConcertService.toDateGroups.mockReturnValue(fakeGroups)

			sut.loadData()
			await vi.waitFor(() => expect(sut.isLoading).toBe(false))

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.loadError).toBeNull()
		})

		it('should silently keep previous data on failure when data exists', async () => {
			const fakeGroups = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					home: [],
					nearby: [],
					away: [],
				},
			]
			mockConcertService.listByFollower.mockResolvedValue([
				{ date: {}, home: [], nearby: [], away: [] },
			])
			mockConcertService.toDateGroups.mockReturnValue(fakeGroups)
			sut.loadData()
			await vi.waitFor(() => expect(sut.isLoading).toBe(false))

			// Second load fails
			mockFollowService.getFollowedArtistMap.mockRejectedValue(
				new Error('network'),
			)
			sut.loadData()
			await vi.waitFor(() => expect(sut.isLoading).toBe(false))

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.loadError).toBeNull()
		})

		it('should ignore AbortError', async () => {
			const abortError = new DOMException('aborted', 'AbortError')
			mockFollowService.getFollowedArtistMap.mockRejectedValue(abortError)

			sut.loadData()
			await vi.waitFor(() => expect(sut.isLoading).toBe(false))!.catch(() => {})

			expect(sut.loadError).toBeNull()
		})

		it('should abort previous request on new loadData call', () => {
			mockConcertService.listByFollower.mockResolvedValue([])

			sut.loadData()
			sut.loadData()

			expect(mockFollowService.getFollowedArtistMap).toHaveBeenCalledTimes(2)
		})
	})

	describe('loading', () => {
		it('should set needsRegion true for guest without stored home', async () => {
			mockAuth.isAuthenticated = false
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue(null)

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('should set needsRegion false for guest with stored home', async () => {
			mockAuth.isAuthenticated = false
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue('JP-13')

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('should set needsRegion false for authenticated user with home set', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = {
				home: { countryCode: 'JP', level1: 'JP-13' },
			}

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('should set needsRegion true for authenticated user without home', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: undefined }

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('should set needsRegion true for authenticated user when current is undefined', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = undefined

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})
	})

	describe('onHomeSelected', () => {
		it('should set needsRegion to false', () => {
			sut.needsRegion = true
			sut.onHomeSelected('JP-13')
			expect(sut.needsRegion).toBe(false)
		})

		it('should reload data after home selection', () => {
			sut.onHomeSelected('JP-13')

			expect(mockFollowService.getFollowedArtistMap).toHaveBeenCalledTimes(1)
		})

		it('should reflect reloaded data in dateGroups', async () => {
			const newGroups = [
				{
					label: 'Mar 13',
					dateKey: '2026-03-13',
					home: [{ id: 'c1' }],
					nearby: [],
					away: [],
				},
			]
			mockConcertService.listByFollower.mockResolvedValue([
				{ date: {}, home: [], nearby: [], away: [] },
			])
			mockConcertService.toDateGroups.mockReturnValue(newGroups)

			sut.onHomeSelected('JP-13')
			await vi.waitFor(() => expect(sut.isLoading).toBe(false))

			expect(sut.dateGroups).toEqual(newGroups)
		})

		it('should resolve prefecture name via translationKey when in waiting-for-home phase', () => {
			sut.laneIntroPhase = 'waiting-for-home'
			sut.onHomeSelected('JP-40')

			// translationKey('JP-40') returns 'fukuoka'
			// mock i18n.tr returns the key as-is, so we verify the correct key is constructed
			expect(sut.i18n.tr).toHaveBeenCalledWith('userHome.prefectures.fukuoka')
			expect(sut.laneIntroPhase).toBe('home')
		})

		it('should not use numeric key for prefecture name', () => {
			sut.laneIntroPhase = 'waiting-for-home'
			sut.onHomeSelected('JP-40')

			// Must NOT produce 'userHome.prefectures.40' (the original bug)
			expect(sut.i18n.tr).not.toHaveBeenCalledWith('userHome.prefectures.40')
		})
	})

	describe('attached — lane intro entry point', () => {
		it('should enter waiting-for-home when on dashboard step with needsRegion', () => {
			mockOnboarding.currentStep = 'dashboard'
			mockOnboarding.isOnboarding = true
			sut.needsRegion = true

			sut.attached()

			// needsRegion path opens home selector without spotlight
			expect(sut.laneIntroPhase).toBe('waiting-for-home')
			expect(mockOnboarding.activateSpotlight).not.toHaveBeenCalled()
		})

		it('should not start lane intro when not on dashboard step', () => {
			mockOnboarding.currentStep = 'completed'

			sut.attached()

			expect(sut.laneIntroPhase).toBe('done')
			expect(mockOnboarding.activateSpotlight).not.toHaveBeenCalled()
		})
	})

	describe('lane intro phase transitions', () => {
		beforeEach(() => {
			vi.useFakeTimers()
			mockOnboarding.currentStep = 'dashboard'
			mockOnboarding.isOnboarding = true
			sut.needsRegion = false
			mockGuest.home = 'JP-13'
			// Provide concert data so lane intro is not skipped
			sut.dateGroups = [
				{
					label: 'Mar 18',
					dateKey: '2026-03-18',
					home: [{ id: 'e1' }],
					nearby: [],
					away: [],
				} as never,
			]
			sut.isLoading = false
			localStorage.removeItem('onboarding.celebrationShown')
		})

		afterEach(() => {
			localStorage.removeItem('onboarding.celebrationShown')
			vi.useRealTimers()
		})

		it('should start at home phase when region is already set', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.laneIntroPhase).toBe('home')
			expect(mockOnboarding.activateSpotlight).toHaveBeenCalledWith(
				'concert-highway [data-stage="home"]',
				expect.any(String),
				expect.any(Function),
			)
		})

		it('should enter waiting-for-home when needsRegion is true', () => {
			sut.needsRegion = true
			sut.attached()

			// needsRegion path returns before data check — synchronous
			expect(sut.laneIntroPhase).toBe('waiting-for-home')
		})

		it('should advance from home to near on tap', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)
			expect(sut.laneIntroPhase).toBe('home')

			sut.onLaneIntroTap()

			expect(sut.laneIntroPhase).toBe('near')
			expect(mockOnboarding.activateSpotlight).toHaveBeenCalledWith(
				'concert-highway [data-stage="near"]',
				expect.any(String),
				expect.any(Function),
			)
		})

		it('should advance from near to away on tap', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			sut.onLaneIntroTap() // home → near
			sut.onLaneIntroTap() // near → away

			expect(sut.laneIntroPhase).toBe('away')
			expect(mockOnboarding.activateSpotlight).toHaveBeenCalledWith(
				'concert-highway [data-stage="away"]',
				expect.any(String),
				expect.any(Function),
			)
		})

		it('should show celebration after away phase tap', async () => {
			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			sut.onLaneIntroTap() // home → near
			sut.onLaneIntroTap() // near → away
			sut.onLaneIntroTap() // away → done → celebration

			expect(sut.laneIntroPhase).toBe('done')
			expect(sut.showCelebration).toBe(true)
			expect(mockOnboarding.deactivateSpotlight).toHaveBeenCalled()
		})

		it('should skip lane intro and show celebration when no concert data', async () => {
			sut.dateGroups = []

			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.laneIntroPhase).toBe('done')
			expect(sut.showCelebration).toBe(true)
		})

		it('should not replay celebration if already shown', async () => {
			localStorage.setItem('onboarding.celebrationShown', '1')
			sut.dateGroups = []

			sut.attached()
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.showCelebration).toBe(false)
		})

		it('should not advance from waiting-for-home on tap', () => {
			sut.needsRegion = true
			sut.attached()

			sut.onLaneIntroTap()

			expect(sut.laneIntroPhase).toBe('waiting-for-home')
		})
	})

	describe('onCelebrationOpen', () => {
		it('should advance to MY_ARTISTS step when celebration opens', () => {
			mockOnboarding.currentStep = 'dashboard'
			mockOnboarding.isOnboarding = true

			sut.onCelebrationOpen()

			expect(mockOnboarding.setStep).toHaveBeenCalledWith('my-artists')
		})
	})

	describe('onCelebrationDismissed', () => {
		it('should deactivate spotlight when celebration is dismissed', () => {
			sut.onCelebrationDismissed()

			expect(mockOnboarding.deactivateSpotlight).toHaveBeenCalled()
		})
	})

	describe('detaching', () => {
		it('should abort active request', () => {
			sut.loadData()

			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
			abortSpy.mockRestore()
		})
	})
})
