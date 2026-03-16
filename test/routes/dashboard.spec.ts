import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const mockIDashboardService = DI.createInterface('IDashboardService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockILocalArtistClient = DI.createInterface('ILocalArtistClient')
const mockIAuthService = DI.createInterface('IAuthService')
const mockIUserService = DI.createInterface('IUserService')

vi.mock('../../src/services/dashboard-service', () => ({
	IDashboardService: mockIDashboardService,
}))

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
	OnboardingStep: {
		LP: 0,
		DISCOVER: 1,
		LOADING: 2,
		DASHBOARD: 3,
		DETAIL: 4,
		MY_ARTISTS: 5,
		SIGNUP: 6,
		COMPLETED: 7,
	},
}))

vi.mock('../../src/services/local-artist-client', () => ({
	ILocalArtistClient: mockILocalArtistClient,
}))

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/services/user-service', () => ({
	IUserService: mockIUserService,
}))

vi.mock('../../src/components/user-home-selector/user-home-selector', () => ({
	UserHomeSelector: {
		getStoredHome: vi.fn().mockReturnValue(null),
	},
}))

const { Dashboard } = await import('../../src/routes/dashboard')
const { UserHomeSelector } = await import(
	'../../src/components/user-home-selector/user-home-selector'
)

describe('Dashboard', () => {
	let sut: InstanceType<typeof Dashboard>
	let mockDashboardService: {
		loadDashboardEvents: ReturnType<typeof vi.fn>
	}
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockOnboarding: {
		currentStep: number
		isOnboarding: boolean
		setStep: ReturnType<typeof vi.fn>
		complete: ReturnType<typeof vi.fn>
		activateSpotlight: ReturnType<typeof vi.fn>
		deactivateSpotlight: ReturnType<typeof vi.fn>
	}
	let mockLocalClient: {
		followedCount: number
		setAdminArea: ReturnType<typeof vi.fn>
		setHome: ReturnType<typeof vi.fn>
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
	}

	beforeEach(() => {
		mockDashboardService = {
			loadDashboardEvents: vi.fn().mockResolvedValue([]),
		}
		mockRouter = createMockRouter()
		mockOnboarding = {
			currentStep: 7,
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
			activateSpotlight: vi.fn(),
			deactivateSpotlight: vi.fn(),
		}
		mockLocalClient = {
			followedCount: 0,
			setAdminArea: vi.fn(),
			setHome: vi.fn(),
		}
		mockAuth = {
			isAuthenticated: false,
		}
		mockUserClient = {
			get: vi.fn().mockResolvedValue({ user: undefined }),
		}
		mockUser = {
			client: mockUserClient,
			current: undefined as
				| { home?: { countryCode: string; level1: string } }
				| undefined,
			updateHome: vi.fn().mockResolvedValue(undefined),
		}

		const container = createTestContainer(
			Registration.instance(mockIDashboardService, mockDashboardService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockILocalArtistClient, mockLocalClient),
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIUserService, mockUser),
		)
		container.register(Dashboard)
		sut = container.get(Dashboard)
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
					main: [],
					region: [],
					other: [],
				},
			]
			mockDashboardService.loadDashboardEvents.mockResolvedValue(fakeGroups)

			sut.loadData()
			await sut.dataPromise

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.loadError).toBeNull()
		})

		it('should silently keep previous data on failure when data exists', async () => {
			// First load succeeds
			const fakeGroups = [
				{
					label: 'Jan 1',
					dateKey: '2026-01-01',
					main: [],
					region: [],
					other: [],
				},
			]
			mockDashboardService.loadDashboardEvents.mockResolvedValue(fakeGroups)
			sut.loadData()
			await sut.dataPromise

			// Second load fails
			mockDashboardService.loadDashboardEvents.mockRejectedValue(
				new Error('network'),
			)
			sut.loadData()
			await sut.dataPromise

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.loadError).toBeNull()
		})

		it('should ignore AbortError', async () => {
			const abortError = new DOMException('aborted', 'AbortError')
			mockDashboardService.loadDashboardEvents.mockRejectedValue(abortError)

			sut.loadData()
			await sut.dataPromise!.catch(() => {})

			expect(sut.loadError).toBeNull()
		})

		it('should abort previous request on new loadData call', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.loadData()
			sut.loadData()

			// loadDashboardEvents is called twice
			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(2)
		})
	})

	describe('loading', () => {
		it('should set needsRegion true for guest without stored home', async () => {
			mockAuth.isAuthenticated = false
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue(null)
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(1)
		})

		it('should set needsRegion false for guest with stored home', async () => {
			mockAuth.isAuthenticated = false
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue('JP-13')
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('should set needsRegion false for authenticated user with home set', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: { countryCode: 'JP', level1: 'JP-13' } }
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('should set needsRegion true for authenticated user without home', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: undefined }
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('should set needsRegion true for authenticated user when current is undefined', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = undefined
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

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
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.onHomeSelected('JP-13')

			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(1)
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
			mockDashboardService.loadDashboardEvents.mockResolvedValue(newGroups)

			sut.onHomeSelected('JP-13')
			await sut.dataPromise

			expect(sut.dateGroups).toEqual(newGroups)
		})
	})

	describe('onCelebrationComplete (lane intro with empty data)', () => {
		it('should skip lane intro and advance to Step 4 when no concert data', async () => {
			mockOnboarding.currentStep = 3
			mockOnboarding.isOnboarding = true
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.loadData()
			await sut.dataPromise

			// Simulate celebration completing
			sut.showCelebration = true
			sut.onCelebrationComplete()

			// Wait for the async startLaneIntro to complete
			await new Promise((r) => setTimeout(r, 50))

			expect(sut.showCelebration).toBe(false)
			expect(sut.laneIntroPhase).toBe('done')
			expect(mockOnboarding.setStep).toHaveBeenCalledWith(4) // DETAIL
			expect(mockOnboarding.activateSpotlight).toHaveBeenCalledWith(
				'[data-nav="my-artists"]',
				expect.any(String),
				expect.any(Function),
			)
		})
	})

	describe('detaching', () => {
		it('should abort active request', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])
			sut.loadData()

			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
			abortSpy.mockRestore()
		})
	})
})
