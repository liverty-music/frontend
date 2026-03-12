import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const mockIDashboardService = DI.createInterface('IDashboardService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockILocalArtistClient = DI.createInterface('ILocalArtistClient')

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
		}

		const container = createTestContainer(
			Registration.instance(mockIDashboardService, mockDashboardService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockILocalArtistClient, mockLocalClient),
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

		it('should preserve stale data on failure when data exists', async () => {
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
			await sut.dataPromise!.catch(() => {})

			expect(sut.dateGroups).toEqual(fakeGroups)
			expect(sut.isStale).toBe(true)
			expect(sut.loadError).toBeInstanceOf(Error)
		})

		it('should ignore AbortError', async () => {
			const abortError = new DOMException('aborted', 'AbortError')
			mockDashboardService.loadDashboardEvents.mockRejectedValue(abortError)

			sut.loadData()
			await sut.dataPromise!.catch(() => {})

			expect(sut.loadError).toBeNull()
			expect(sut.isStale).toBe(false)
		})

		it('should abort previous request on new loadData call', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.loadData()
			sut.loadData()

			// loadDashboardEvents is called twice
			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(2)
		})
	})

	describe('retry', () => {
		it('should call loadData again', () => {
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			sut.retry()

			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(1)
		})
	})

	describe('loading', () => {
		it('should check region and load data', async () => {
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue(null)
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
			expect(mockDashboardService.loadDashboardEvents).toHaveBeenCalledTimes(1)
		})

		it('should not need region when stored region exists', async () => {
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue('Tokyo')
			mockDashboardService.loadDashboardEvents.mockResolvedValue([])

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})
	})

	describe('onHomeSelected', () => {
		it('should set needsRegion to false', () => {
			sut.needsRegion = true
			sut.onHomeSelected('JP-13')
			expect(sut.needsRegion).toBe(false)
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
				'[data-nav-my-artists]',
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
