import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Artist } from '../../../src/entities/artist'
import {
	type SearchClient,
	SearchController,
	type SearchControllerCallbacks,
} from '../../../src/routes/discovery/search-controller'
import { createMockLogger } from '../../../test/helpers/mock-logger'

function makeArtist(id: string, name: string): Artist {
	return new Artist({
		id: { value: id },
		name: { value: name },
	})
}

describe('SearchController', () => {
	let sut: SearchController
	let mockClient: SearchClient
	let mockCallbacks: SearchControllerCallbacks

	beforeEach(() => {
		vi.useFakeTimers()

		mockClient = {
			search: vi.fn().mockResolvedValue([]),
		}

		mockCallbacks = {
			onEnterSearchMode: vi.fn(),
			onExitSearchMode: vi.fn(),
			onError: vi.fn(),
		}

		sut = new SearchController(mockClient, mockCallbacks, createMockLogger())
	})

	afterEach(() => {
		sut.dispose()
		vi.useRealTimers()
	})

	describe('onQueryChanged', () => {
		it('should debounce search by 300ms', async () => {
			sut.searchQuery = 'test'
			sut.onQueryChanged('test')

			expect(mockClient.search).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)

			expect(mockClient.search).toHaveBeenCalledWith('test')
		})

		it('should enter search mode and notify callback', () => {
			sut.onQueryChanged('hello')

			expect(sut.isSearchMode).toBe(true)
			expect(mockCallbacks.onEnterSearchMode).toHaveBeenCalled()
		})

		it('should exit search mode when query is empty', () => {
			sut.isSearchMode = true
			sut.onQueryChanged('')

			expect(sut.isSearchMode).toBe(false)
			expect(mockCallbacks.onExitSearchMode).toHaveBeenCalled()
		})

		it('should cancel previous debounce on new input', async () => {
			sut.searchQuery = 'first'
			sut.onQueryChanged('first')

			await vi.advanceTimersByTimeAsync(100)
			sut.searchQuery = 'second'
			sut.onQueryChanged('second')

			await vi.advanceTimersByTimeAsync(300)

			expect(mockClient.search).toHaveBeenCalledTimes(1)
			expect(mockClient.search).toHaveBeenCalledWith('second')
		})

		it('should discard stale responses', async () => {
			const results = [makeArtist('a1', 'Artist')]
			;(mockClient.search as ReturnType<typeof vi.fn>).mockResolvedValue(
				results,
			)

			sut.searchQuery = 'query'
			sut.onQueryChanged('query')

			// Change query before response arrives
			await vi.advanceTimersByTimeAsync(150)
			sut.searchQuery = 'different'

			await vi.advanceTimersByTimeAsync(150)

			// Results should not be set since query changed
			expect(sut.searchResults).toHaveLength(0)
		})
	})

	describe('clearSearch', () => {
		it('should reset searchQuery', () => {
			sut.searchQuery = 'something'
			sut.clearSearch()
			expect(sut.searchQuery).toBe('')
		})
	})

	describe('exitSearchMode', () => {
		it('should reset all search state', () => {
			sut.isSearchMode = true
			sut.searchResults = [makeArtist('a1', 'A')]
			sut.isSearching = true

			sut.exitSearchMode()

			expect(sut.isSearchMode).toBe(false)
			expect(sut.searchResults).toHaveLength(0)
			expect(sut.isSearching).toBe(false)
			expect(mockCallbacks.onExitSearchMode).toHaveBeenCalled()
		})
	})

	describe('performSearch error handling', () => {
		it('should call onError callback on search failure', async () => {
			;(mockClient.search as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network'),
			)

			sut.searchQuery = 'fail'
			sut.onQueryChanged('fail')
			await vi.advanceTimersByTimeAsync(300)

			expect(mockCallbacks.onError).toHaveBeenCalledWith(
				'discovery.searchFailed',
			)
			expect(sut.searchResults).toHaveLength(0)
			expect(sut.isSearching).toBe(false)
		})

		it('should set isSearching during search', async () => {
			let resolveSearch: (value: Artist[]) => void
			;(mockClient.search as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise<Artist[]>((resolve) => {
					resolveSearch = resolve
				}),
			)

			sut.searchQuery = 'test'
			sut.onQueryChanged('test')
			await vi.advanceTimersByTimeAsync(300)

			expect(sut.isSearching).toBe(true)

			resolveSearch!([])
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.isSearching).toBe(false)
		})
	})

	describe('dispose', () => {
		it('should cancel pending debounce timer', async () => {
			sut.searchQuery = 'test'
			sut.onQueryChanged('test')

			sut.dispose()
			await vi.advanceTimersByTimeAsync(300)

			expect(mockClient.search).not.toHaveBeenCalled()
		})
	})
})
