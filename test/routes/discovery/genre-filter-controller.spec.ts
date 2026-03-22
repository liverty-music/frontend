import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../../src/entities/artist'
import { BubblePool } from '../../../src/services/bubble-pool'
import { createMockLogger } from '../../../test/helpers/mock-logger'

vi.mock('../../../src/util/detect-country', () => ({
	detectCountryFromTimezone: () => 'Japan',
}))

const { GenreFilterController } = await import(
	'../../../src/routes/discovery/genre-filter-controller'
)
type GenreArtistClient =
	import('../../../src/routes/discovery/genre-filter-controller').GenreArtistClient
type GenreFilterCallbacks =
	import('../../../src/routes/discovery/genre-filter-controller').GenreFilterCallbacks

function makeArtist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
}

describe('GenreFilterController', () => {
	let sut: GenreFilterController
	let mockClient: GenreArtistClient
	let mockCallbacks: GenreFilterCallbacks
	let pool: BubblePool
	let abortController: AbortController

	beforeEach(() => {
		mockClient = {
			listTop: vi.fn().mockResolvedValue([]),
		}

		mockCallbacks = {
			onBubblesReloaded: vi.fn(),
			onError: vi.fn(),
		}

		pool = new BubblePool()
		abortController = new AbortController()

		sut = new GenreFilterController(
			mockClient,
			pool,
			() => [],
			mockCallbacks,
			createMockLogger(),
			() => abortController.signal,
		)
	})

	describe('onGenreSelected', () => {
		it('should activate a genre tag and reload bubbles', async () => {
			const artists = [makeArtist('a1', 'Rock Artist')]
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				artists,
			)

			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('Rock')
			expect(mockClient.listTop).toHaveBeenCalledWith('', 'rock', 50)
			expect(mockCallbacks.onBubblesReloaded).toHaveBeenCalled()
		})

		it('should deactivate when selecting same tag', async () => {
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([])

			await sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('')
			expect(mockClient.listTop).toHaveBeenLastCalledWith('Japan', '', 50)
		})

		it('should set isLoadingTag during load', async () => {
			let resolveListTop: (value: Artist[]) => void
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise<Artist[]>((resolve) => {
					resolveListTop = resolve
				}),
			)

			const promise = sut.onGenreSelected('Jazz')
			expect(sut.isLoadingTag).toBe(true)

			resolveListTop!([])
			await promise
			expect(sut.isLoadingTag).toBe(false)
		})

		it('should ignore requests while loading', async () => {
			let resolveListTop: (value: Artist[]) => void
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise<Artist[]>((resolve) => {
					resolveListTop = resolve
				}),
			)

			const first = sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Pop') // Should be ignored

			resolveListTop!([])
			await first

			expect(sut.activeTag).toBe('Rock')
			expect(mockClient.listTop).toHaveBeenCalledTimes(1)
		})

		it('should exclude followed artists from dedup', async () => {
			const followed = [makeArtist('f1', 'Followed Artist')]
			sut = new GenreFilterController(
				mockClient,
				pool,
				() => followed,
				mockCallbacks,
				createMockLogger(),
				() => abortController.signal,
			)

			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeArtist('f1', 'Followed Artist'),
				makeArtist('a1', 'Available Artist'),
			])

			await sut.onGenreSelected('Rock')

			expect(pool.availableBubbles).toHaveLength(1)
			expect(pool.availableBubbles[0].id).toBe('a1')
		})

		it('should reset activeTag and call onError on failure', async () => {
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network'),
			)

			await sut.onGenreSelected('Metal')

			expect(sut.activeTag).toBe('')
			expect(mockCallbacks.onError).toHaveBeenCalledWith(
				'discovery.genreLoadFailed',
				{ tag: 'Metal' },
			)
		})
	})
})
