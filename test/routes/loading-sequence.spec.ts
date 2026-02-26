import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'
import { createMockLoadingSequenceService } from '../helpers/mock-loading-sequence'
import { createMockRouter } from '../helpers/mock-router'
import { createMockArtistDiscoveryService } from '../helpers/mock-rpc-clients'
import { createMockToastService } from '../helpers/mock-toast'

const mockIRouter = DI.createInterface('IRouter')
const mockIArtistDiscoveryService = DI.createInterface(
	'IArtistDiscoveryService',
)
const mockILoadingSequenceService = DI.createInterface(
	'ILoadingSequenceService',
)
const mockIToastService = DI.createInterface('IToastService')
const mockIErrorBoundaryService = DI.createInterface('IErrorBoundaryService')
const mockILocalArtistClient = DI.createInterface('ILocalArtistClient')
const mockIOnboardingService = DI.createInterface('IOnboardingService')

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/artist-discovery-service', () => ({
	IArtistDiscoveryService: mockIArtistDiscoveryService,
}))

vi.mock('../../src/services/loading-sequence-service', () => ({
	ILoadingSequenceService: mockILoadingSequenceService,
}))

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
}))

vi.mock('../../src/services/error-boundary-service', () => ({
	IErrorBoundaryService: mockIErrorBoundaryService,
}))

vi.mock('../../src/services/local-artist-client', () => ({
	ILocalArtistClient: mockILocalArtistClient,
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

vi.mock('./loading-sequence.css?raw', () => ({
	default: '',
}))

vi.mock('../../src/routes/onboarding-loading/loading-sequence.css?raw', () => ({
	default: '',
}))

const { LoadingSequence } = await import(
	'../../src/routes/onboarding-loading/loading-sequence'
)

describe('LoadingSequence', () => {
	let sut: InstanceType<typeof LoadingSequence>
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockDiscovery: ReturnType<typeof createMockArtistDiscoveryService>
	let mockLoadingService: ReturnType<typeof createMockLoadingSequenceService>
	let mockToast: ReturnType<typeof createMockToastService>
	let mockErrorBoundary: ReturnType<typeof createMockErrorBoundary>
	let mockOnboarding: {
		currentStep: number
		isOnboarding: boolean
		setStep: ReturnType<typeof vi.fn>
		complete: ReturnType<typeof vi.fn>
	}
	let mockLocalClient: {
		followedCount: number
		setRegion: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.useFakeTimers()

		mockRouter = createMockRouter()
		mockDiscovery = createMockArtistDiscoveryService()
		mockLoadingService = createMockLoadingSequenceService()
		mockToast = createMockToastService()
		mockErrorBoundary = createMockErrorBoundary()
		mockOnboarding = {
			currentStep: 7,
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
		}
		mockLocalClient = {
			followedCount: 0,
			setRegion: vi.fn(),
		}

		const container = createTestContainer(
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIArtistDiscoveryService, mockDiscovery),
			Registration.instance(mockILoadingSequenceService, mockLoadingService),
			Registration.instance(mockIToastService, mockToast),
			Registration.instance(mockIErrorBoundaryService, mockErrorBoundary),
			Registration.instance(mockILocalArtistClient, mockLocalClient),
			Registration.instance(mockIOnboardingService, mockOnboarding),
		)
		container.register(LoadingSequence)
		sut = container.get(LoadingSequence)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('canLoad', () => {
		it('should redirect to dashboard when backend has followed artists', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])

			const result = await sut.canLoad()

			expect(result).toBe('dashboard')
		})

		it('should redirect to discovery when no followed artists anywhere', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([])
			mockDiscovery.followedArtists = []

			const result = await sut.canLoad()

			expect(result).toBe('onboarding/discover')
		})

		it('should allow access when local followed artists exist but none in backend', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([])
			mockDiscovery.followedArtists = [
				{
					id: 'a1',
					name: 'Local Artist',
					mbid: '',
					imageUrl: '',
					x: 0,
					y: 0,
					radius: 30,
				},
			]

			const result = await sut.canLoad()

			expect(result).toBe(true)
		})

		it('should fallback to local state when backend fetch fails with local artists', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockRejectedValue(new Error('network error'))
			mockDiscovery.followedArtists = [
				{
					id: 'a1',
					name: 'Local Artist',
					mbid: '',
					imageUrl: '',
					x: 0,
					y: 0,
					radius: 30,
				},
			]

			const result = await sut.canLoad()

			expect(result).toBe(true)
		})

		it('should redirect to discovery when backend fails and no local artists', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockRejectedValue(new Error('network error'))
			mockDiscovery.followedArtists = []

			const result = await sut.canLoad()

			expect(result).toBe('onboarding/discover')
		})
	})

	describe('loading - aggregation result handling', () => {
		it('should navigate to dashboard on success', async () => {
			;(
				mockLoadingService.aggregateData as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				status: 'success',
			})

			sut.binding()
			await sut.loading()

			// attached() defers navigation via setTimeout
			sut.attached()
			await vi.advanceTimersByTimeAsync(1)

			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})

		it('should show warning toast on partial failure', async () => {
			;(
				mockLoadingService.aggregateData as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				status: 'partial',
				failedCount: 2,
				totalCount: 5,
			})

			sut.binding()
			await sut.loading()

			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('2/5'),
				'warning',
			)

			sut.attached()
			await vi.advanceTimersByTimeAsync(1)

			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})

		it('should capture error on complete failure', async () => {
			const testError = new Error('aggregation failed')
			;(
				mockLoadingService.aggregateData as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				status: 'failed',
				error: testError,
			})

			sut.binding()
			await sut.loading()

			expect(mockErrorBoundary.captureError).toHaveBeenCalledWith(
				testError,
				'LoadingSequence:aggregateData',
			)

			sut.attached()
			await vi.advanceTimersByTimeAsync(1)

			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})
	})

	describe('unbinding', () => {
		it('should clear phase timer', () => {
			;(
				mockLoadingService.aggregateData as ReturnType<typeof vi.fn>
			).mockReturnValue(new Promise(() => {}))

			sut.binding()
			// loading() calls startPhaseAnimation() which sets phaseTimer
			sut.loading()

			const clearSpy = vi.spyOn(global, 'clearTimeout')
			sut.unbinding()

			expect(clearSpy).toHaveBeenCalled()
			clearSpy.mockRestore()
		})
	})

	describe('getPhaseClass', () => {
		it('should return "phase-visible" when phase is visible', () => {
			sut.isPhaseVisible = true
			expect(sut.getPhaseClass()).toBe('phase-visible')
		})

		it('should return empty string when phase is not visible', () => {
			sut.isPhaseVisible = false
			expect(sut.getPhaseClass()).toBe('')
		})
	})

	describe('getStepDotClass', () => {
		it('should return "completed" for phases before current', () => {
			sut.currentPhase = 3
			expect(sut.getStepDotClass(0)).toBe('completed')
			expect(sut.getStepDotClass(1)).toBe('completed')
		})

		it('should return "active" for current phase', () => {
			sut.currentPhase = 2
			expect(sut.getStepDotClass(1)).toBe('active')
		})

		it('should return empty string for future phases', () => {
			sut.currentPhase = 1
			expect(sut.getStepDotClass(1)).toBe('')
			expect(sut.getStepDotClass(2)).toBe('')
		})
	})
})
