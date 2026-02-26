import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtistBubble } from '../../src/services/artist-discovery-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockArtistDiscoveryService } from '../helpers/mock-rpc-clients'
import { createMockToastService } from '../helpers/mock-toast'

const mockIArtistDiscoveryService = DI.createInterface(
	'IArtistDiscoveryService',
)
const mockIToastService = DI.createInterface('IToastService')

vi.mock('../../src/services/artist-discovery-service', () => ({
	IArtistDiscoveryService: mockIArtistDiscoveryService,
}))

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
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
	let mockDiscovery: ReturnType<typeof createMockArtistDiscoveryService>
	let mockToast: ReturnType<typeof createMockToastService>

	beforeEach(() => {
		vi.useFakeTimers()

		mockDiscovery = createMockArtistDiscoveryService()
		mockToast = createMockToastService()

		const container = createTestContainer(
			Registration.instance(mockIArtistDiscoveryService, mockDiscovery),
			Registration.instance(mockIToastService, mockToast),
		)
		container.register(DiscoverPage)
		sut = container.get(DiscoverPage)

		// Stub the dnaOrbCanvas ref
		sut.dnaOrbCanvas = {
			pause: vi.fn(),
			resume: vi.fn(),
			reloadBubbles: vi.fn(),
		} as any
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('loading', () => {
		it('should load initial artists', async () => {
			await sut.loading()

			expect(mockDiscovery.loadInitialArtists).toHaveBeenCalledWith('Japan', '')
		})

		it('should show toast on load failure', async () => {
			;(
				mockDiscovery.loadInitialArtists as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('fail'))

			await sut.loading()

			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('Failed'),
				'error',
			)
		})
	})

	describe('onSearchQueryChanged (debounced search)', () => {
		it('should debounce search by 300ms', async () => {
			mockDiscovery.searchArtists = vi
				.fn()
				.mockResolvedValue([makeBubble('a1', 'Result')])

			sut.searchQuery = 'test'
			;(sut as any).onSearchQueryChanged('test')

			// Before 300ms
			expect(mockDiscovery.searchArtists).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)

			expect(mockDiscovery.searchArtists).toHaveBeenCalledWith('test')
		})

		it('should exit search mode when query is empty', () => {
			sut.isSearchMode = true
			;(sut as any).onSearchQueryChanged('')

			expect(sut.isSearchMode).toBe(false)
		})

		it('should discard stale responses by checking current query', async () => {
			// The debounce resets, so only the latest query fires
			mockDiscovery.searchArtists = vi
				.fn()
				.mockResolvedValue([makeBubble('a2', 'Fresh')])

			sut.searchQuery = 'first'
			;(sut as any).onSearchQueryChanged('first')

			// Before debounce fires, start a new search (cancels the first timer)
			await vi.advanceTimersByTimeAsync(100)
			sut.searchQuery = 'second'
			;(sut as any).onSearchQueryChanged('second')

			await vi.advanceTimersByTimeAsync(300)

			// Only one search should have been triggered (the second one)
			expect(mockDiscovery.searchArtists).toHaveBeenCalledTimes(1)
			expect(mockDiscovery.searchArtists).toHaveBeenCalledWith('second')
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
		beforeEach(() => {
			mockDiscovery.reloadWithTag = vi.fn().mockResolvedValue(undefined)
		})

		it('should activate a genre tag', async () => {
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('Rock')
			expect(mockDiscovery.reloadWithTag).toHaveBeenCalledWith('rock')
		})

		it('should deactivate when selecting same tag', async () => {
			await sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('')
			expect(mockDiscovery.reloadWithTag).toHaveBeenLastCalledWith('')
		})
	})

	describe('onFollowFromSearch', () => {
		it('should follow artist and check live events', async () => {
			mockDiscovery.isFollowed = vi.fn().mockReturnValue(false)
			;(
				mockDiscovery.checkLiveEvents as ReturnType<typeof vi.fn>
			).mockResolvedValue(true)

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockDiscovery.followArtist).toHaveBeenCalled()
			expect(mockToast.show).toHaveBeenCalledWith(
				expect.stringContaining('upcoming live events'),
			)
		})

		it('should not follow already-followed artist', async () => {
			mockDiscovery.isFollowed = vi.fn().mockReturnValue(true)

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockDiscovery.followArtist).not.toHaveBeenCalled()
		})
	})
})
