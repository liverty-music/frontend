import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'
import { createMockArtistDiscoveryService } from '../helpers/mock-rpc-clients'
import { createMockToastService } from '../helpers/mock-toast'

const mockIArtistDiscoveryService = DI.createInterface(
	'IArtistDiscoveryService',
)
const mockIToastService = DI.createInterface('IToastService')
const mockIRouter = DI.createInterface('IRouter')

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/artist-discovery-service', () => ({
	IArtistDiscoveryService: mockIArtistDiscoveryService,
}))

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
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
	let mockToast: ReturnType<typeof createMockToastService>
	let mockRouter: ReturnType<typeof createMockRouter>

	beforeEach(() => {
		vi.useFakeTimers()

		mockDiscovery = createMockArtistDiscoveryService()
		mockToast = createMockToastService()
		mockRouter = createMockRouter()

		const container = createTestContainer(
			Registration.instance(mockIArtistDiscoveryService, mockDiscovery),
			Registration.instance(mockIToastService, mockToast),
			Registration.instance(mockIRouter, mockRouter),
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
				expect.stringContaining('Failed'),
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

	describe('guidance auto-dismiss', () => {
		it('should dismiss guidance after 5s + 400ms fade', async () => {
			sut.attached()

			expect(sut.showGuidance).toBe(true)

			// After 5s the dismissGuidance triggers
			await vi.advanceTimersByTimeAsync(5000)
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

			expect(mockDiscovery.followArtist).toHaveBeenCalled()
			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('upcoming live events'),
			)
		})

		it('should show error toast on follow failure', async () => {
			;(
				mockDiscovery.followArtist as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('fail'))

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
				expect.stringContaining('Failed to follow'),
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
