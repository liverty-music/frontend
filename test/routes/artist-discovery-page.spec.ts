import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'
import {
	createMockArtistDiscoveryService,
	createMockArtistServiceClient,
} from '../helpers/mock-rpc-clients'
import { createMockToastService } from '../helpers/mock-toast'

const mockIArtistDiscoveryService = DI.createInterface(
	'IArtistDiscoveryService',
)
const mockIArtistServiceClient = DI.createInterface('IArtistServiceClient')
const mockIToastService = DI.createInterface('IToastService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockILocalArtistClient = DI.createInterface('ILocalArtistClient')

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/artist-discovery-service', () => ({
	IArtistDiscoveryService: mockIArtistDiscoveryService,
}))

vi.mock('../../src/services/artist-service-client', () => ({
	IArtistServiceClient: mockIArtistServiceClient,
}))

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
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

vi.mock(
	'../../src/routes/artist-discovery/artist-discovery-page.css?raw',
	() => ({
		default: '',
	}),
)

const { ArtistDiscoveryPage } = await import(
	'../../src/routes/artist-discovery/artist-discovery-page'
)

describe('ArtistDiscoveryPage', () => {
	let sut: InstanceType<typeof ArtistDiscoveryPage>
	let mockDiscovery: ReturnType<typeof createMockArtistDiscoveryService>
	let mockArtistService: ReturnType<typeof createMockArtistServiceClient>
	let mockToast: ReturnType<typeof createMockToastService>
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockOnboarding: {
		currentStep: number
		isOnboarding: boolean
		setStep: ReturnType<typeof vi.fn>
		complete: ReturnType<typeof vi.fn>
	}
	let mockLocalClient: {
		followedCount: number
		setAdminArea: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.useFakeTimers()

		mockDiscovery = createMockArtistDiscoveryService()
		mockArtistService = createMockArtistServiceClient()
		mockToast = createMockToastService()
		mockRouter = createMockRouter()
		mockOnboarding = {
			currentStep: 7,
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
		}
		mockLocalClient = {
			followedCount: 0,
			setAdminArea: vi.fn(),
		}

		const container = createTestContainer(
			Registration.instance(mockIArtistDiscoveryService, mockDiscovery),
			Registration.instance(mockIArtistServiceClient, mockArtistService),
			Registration.instance(mockIToastService, mockToast),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockILocalArtistClient, mockLocalClient),
		)
		container.register(ArtistDiscoveryPage)
		sut = container.get(ArtistDiscoveryPage)
	})

	afterEach(() => {
		sut.detaching()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('loading', () => {
		it('should load initial artists', async () => {
			await sut.loading()

			expect(mockDiscovery.loadInitialArtists).toHaveBeenCalled()
			expect(sut.loadFailed).toBe(false)
		})

		it('should set loadFailed on error', async () => {
			;(
				mockDiscovery.loadInitialArtists as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('fail'))

			await sut.loading()

			expect(sut.loadFailed).toBe(true)
			expect(mockToast.show).toHaveBeenCalledWith(
				'discovery.loadFailed',
				'error',
			)
		})
	})

	describe('retryLoad', () => {
		it('should reset loadFailed and retry', async () => {
			sut.loadFailed = true
			await sut.retryLoad()

			expect(sut.loadFailed).toBe(false)
			expect(mockDiscovery.loadInitialArtists).toHaveBeenCalled()
		})

		it('should set loadFailed again on retry failure', async () => {
			;(
				mockDiscovery.loadInitialArtists as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('still failing'))

			await sut.retryLoad()

			expect(sut.loadFailed).toBe(true)
		})
	})

	describe('guidance dismiss on tap', () => {
		it('should dismiss guidance after first artist tap + 400ms fade', async () => {
			expect(sut.showGuidance).toBe(true)

			const artist = {
				id: 'g1',
				name: 'Guidance Artist',
				mbid: '',
				imageUrl: '',
				x: 0,
				y: 0,
				radius: 30,
			}
			const event = new CustomEvent('artist-selected', {
				detail: { artist },
			})

			await sut.onArtistSelected(event)

			// Guidance should be fading
			expect(sut.guidanceHiding).toBe(true)

			// After 400ms fade, guidance is fully hidden
			await vi.advanceTimersByTimeAsync(400)
			expect(sut.showGuidance).toBe(false)
			expect(sut.guidanceHiding).toBe(false)
		})
	})

	describe('onArtistSelected', () => {
		it('should follow artist and check live events', async () => {
			;(
				mockDiscovery.checkLiveEvents as ReturnType<typeof vi.fn>
			).mockResolvedValue(true)

			const artist = {
				id: 'a1',
				name: 'Test Artist',
				mbid: '',
				imageUrl: '',
				x: 0,
				y: 0,
				radius: 30,
			}
			const event = new CustomEvent('artist-selected', {
				detail: { artist },
			})

			await sut.onArtistSelected(event)

			expect(mockArtistService.follow).toHaveBeenCalledWith('a1', 'Test Artist')
			expect(mockDiscovery.markFollowed).toHaveBeenCalledWith(artist)
			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('discovery.hasUpcomingEvents'),
			)
		})

		it('should show error toast on follow failure', async () => {
			;(mockArtistService.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			const event = new CustomEvent('artist-selected', {
				detail: {
					artist: {
						id: 'a1',
						name: 'Test Artist',
						mbid: '',
						imageUrl: '',
						x: 0,
						y: 0,
						radius: 30,
					},
				},
			})

			await sut.onArtistSelected(event)

			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('discovery.followFailed'),
				'error',
			)
		})
	})

	describe('onViewSchedule', () => {
		it('should navigate to /', async () => {
			await sut.onViewSchedule()

			expect(mockRouter.load).toHaveBeenCalledWith('/')
		})
	})
})
