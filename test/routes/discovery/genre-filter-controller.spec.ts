import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IArtistBubbleStore } from '../../../src/services/artist-bubble-store'
import { createMockLogger } from '../../../test/helpers/mock-logger'

vi.mock('../../../src/util/detect-country', () => ({
	detectCountryFromTimezone: () => 'Japan',
}))

const { GenreFilterController } = await import(
	'../../../src/routes/discovery/genre-filter-controller'
)
type GenreFilterCallbacks =
	import('../../../src/routes/discovery/genre-filter-controller').GenreFilterCallbacks

describe('GenreFilterController', () => {
	let sut: GenreFilterController
	let mockStore: { loadTop: ReturnType<typeof vi.fn> }
	let mockCallbacks: GenreFilterCallbacks
	let abortController: AbortController

	beforeEach(() => {
		mockStore = { loadTop: vi.fn().mockResolvedValue(undefined) }
		mockCallbacks = { onError: vi.fn() }
		abortController = new AbortController()

		sut = new GenreFilterController(
			mockStore as unknown as IArtistBubbleStore,
			mockCallbacks,
			createMockLogger(),
			() => abortController.signal,
		)
	})

	describe('onGenreSelected', () => {
		it('activates a genre tag and loads the field for that tag (global, no country)', async () => {
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('Rock')
			expect(mockStore.loadTop).toHaveBeenCalledWith('', 'rock')
		})

		it('deactivates when selecting the same tag and reloads the regional top', async () => {
			await sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('')
			expect(mockStore.loadTop).toHaveBeenLastCalledWith('Japan', '')
		})

		it('sets isLoadingTag during the load', async () => {
			let resolveLoad: () => void = () => {}
			mockStore.loadTop.mockReturnValue(
				new Promise<void>((r) => {
					resolveLoad = r
				}),
			)

			const promise = sut.onGenreSelected('Jazz')
			expect(sut.isLoadingTag).toBe(true)

			resolveLoad()
			await promise
			expect(sut.isLoadingTag).toBe(false)
		})

		it('ignores requests while loading', async () => {
			let resolveLoad: () => void = () => {}
			mockStore.loadTop.mockReturnValue(
				new Promise<void>((r) => {
					resolveLoad = r
				}),
			)

			const first = sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Pop') // ignored

			resolveLoad()
			await first

			expect(sut.activeTag).toBe('Rock')
			expect(mockStore.loadTop).toHaveBeenCalledTimes(1)
		})

		it('resets activeTag and calls onError on failure', async () => {
			mockStore.loadTop.mockRejectedValue(new Error('network'))

			await sut.onGenreSelected('Metal')

			expect(sut.activeTag).toBe('')
			expect(mockCallbacks.onError).toHaveBeenCalledWith(
				'discovery.genreLoadFailed',
				{ tag: 'Metal' },
			)
		})
	})
})
