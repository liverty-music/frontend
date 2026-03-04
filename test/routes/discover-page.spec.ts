import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtistBubble } from '../../src/services/artist-discovery-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'
import {
	createMockArtistServiceClient,
	createMockConcertService,
} from '../helpers/mock-rpc-clients'
import { createMockToastService } from '../helpers/mock-toast'

const mockIArtistServiceClient = DI.createInterface('IArtistServiceClient')
const mockIConcertService = DI.createInterface('IConcertService')
const mockIToastService = DI.createInterface('IToastService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockILocalArtistClient = DI.createInterface('ILocalArtistClient')

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/artist-service-client', () => ({
	IArtistServiceClient: mockIArtistServiceClient,
}))

vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
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

vi.mock('../../src/routes/discover/discover-page.css?raw', () => ({
	default: '',
}))

const { DiscoverPage } = await import('../../src/routes/discover/discover-page')

function makeBubble(id: string, name: string): ArtistBubble {
	return { id, name, mbid: '', imageUrl: '', x: 0, y: 0, radius: 30 }
}

describe('DiscoverPage', () => {
	let sut: InstanceType<typeof DiscoverPage>
	let mockArtistClient: ReturnType<typeof createMockArtistServiceClient>
	let mockConcert: ReturnType<typeof createMockConcertService>
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

		mockArtistClient = createMockArtistServiceClient()
		mockConcert = createMockConcertService()
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
			Registration.instance(mockIArtistServiceClient, mockArtistClient),
			Registration.instance(mockIConcertService, mockConcert),
			Registration.instance(mockIToastService, mockToast),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockILocalArtistClient, mockLocalClient),
		)
		container.register(DiscoverPage)
		sut = container.get(DiscoverPage)

		// Stub the dnaOrbCanvas ref
		sut.dnaOrbCanvas = {
			pause: vi.fn(),
			resume: vi.fn(),
			reloadBubbles: vi.fn(),
			spawnBubblesAt: vi.fn(),
			fadeOutBubbles: vi.fn(),
			bubbleCount: 0,
		} as any
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('loading', () => {
		it('should load initial artists via artistClient.listTop', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeBubble('a1', 'Artist One')],
			)

			await sut.loading()

			expect(mockArtistClient.listTop).toHaveBeenCalledWith('Japan', '', 50)
		})

		it('should show toast on load failure', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			await sut.loading()

			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('Failed'),
				'error',
			)
		})
	})

	describe('onSearchQueryChanged (debounced search)', () => {
		it('should debounce search by 300ms', async () => {
			;(mockArtistClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a1', 'Result'),
			])

			sut.searchQuery = 'test'
			;(sut as any).onSearchQueryChanged('test')

			// Before 300ms
			expect(mockArtistClient.search).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)

			expect(mockArtistClient.search).toHaveBeenCalledWith('test')
		})

		it('should exit search mode when query is empty', () => {
			sut.isSearchMode = true
			;(sut as any).onSearchQueryChanged('')

			expect(sut.isSearchMode).toBe(false)
		})

		it('should discard stale responses by checking current query', async () => {
			;(mockArtistClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a2', 'Fresh'),
			])

			sut.searchQuery = 'first'
			;(sut as any).onSearchQueryChanged('first')

			// Before debounce fires, start a new search
			await vi.advanceTimersByTimeAsync(100)
			sut.searchQuery = 'second'
			;(sut as any).onSearchQueryChanged('second')

			await vi.advanceTimersByTimeAsync(300)

			// Only one search should have been triggered (the second one)
			expect(mockArtistClient.search).toHaveBeenCalledTimes(1)
			expect(mockArtistClient.search).toHaveBeenCalledWith('second')
		})
	})

	describe('clearSearch', () => {
		it('should reset searchQuery', () => {
			sut.searchQuery = 'something'
			sut.clearSearch()
			expect(sut.searchQuery).toBe('')
		})
	})

	describe('onGenreSelected', () => {
		it('should activate a genre tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('Rock')
			expect(mockArtistClient.listTop).toHaveBeenCalledWith('Japan', 'rock', 50)
		})

		it('should deactivate when selecting same tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('')
			expect(mockArtistClient.listTop).toHaveBeenLastCalledWith('Japan', '', 50)
		})
	})

	describe('onFollowFromSearch', () => {
		it('should follow artist and check live events', async () => {
			;(mockArtistClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[{ id: 'c1' }],
			)

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockArtistClient.follow).toHaveBeenCalledWith('a1', 'Artist')
		})

		it('should not follow already-followed artist', async () => {
			// Follow first
			;(mockArtistClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			// Try to follow again
			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockArtistClient.follow).toHaveBeenCalledTimes(1)
		})
	})
})
