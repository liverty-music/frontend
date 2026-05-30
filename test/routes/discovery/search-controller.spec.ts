import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../../src/entities/artist'
import {
	type SearchClient,
	SearchController,
	type SearchControllerCallbacks,
} from '../../../src/routes/discovery/search-controller'
import { createMockLogger } from '../../../test/helpers/mock-logger'

function makeArtist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
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
			onSearchCompleted: vi.fn(),
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

	describe('onSearchCompleted analytics signal', () => {
		// Batch 3c-2a: the discovery-route subscribes via this callback to
		// fire the artist.search analytics event. The callback MUST be
		// invoked exactly once per successful, non-stale search with the
		// observed query length and result count — anything else would
		// pollute the search-quality funnel (aborted searches, failures,
		// or stale responses inflating the count).

		it('invokes onSearchCompleted with query length + result count on success', async () => {
			const results = [
				makeArtist('a1', 'Artist 1'),
				makeArtist('a2', 'Artist 2'),
			]
			;(mockClient.search as ReturnType<typeof vi.fn>).mockResolvedValue(
				results,
			)

			sut.searchQuery = 'beatles'
			sut.onQueryChanged('beatles')
			await vi.advanceTimersByTimeAsync(300)
			// Drain the awaited search promise + the synchronous code that
			// follows it.
			await vi.advanceTimersByTimeAsync(0)

			expect(mockCallbacks.onSearchCompleted).toHaveBeenCalledTimes(1)
			expect(mockCallbacks.onSearchCompleted).toHaveBeenCalledWith({
				queryLength: 7,
				resultCount: 2,
			})
		})

		it('does NOT fire on stale-response early return', async () => {
			;(mockClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeArtist('a1', 'Stale'),
			])

			sut.searchQuery = 'first'
			sut.onQueryChanged('first')
			await vi.advanceTimersByTimeAsync(150)
			sut.searchQuery = 'second'
			await vi.advanceTimersByTimeAsync(150)
			await vi.advanceTimersByTimeAsync(0)

			// The response for 'first' arrived after the user typed
			// 'second'. The stale-query guard short-circuits BEFORE the
			// callback — analytics MUST stay quiet.
			expect(mockCallbacks.onSearchCompleted).not.toHaveBeenCalled()
		})

		it('does NOT fire when search throws', async () => {
			;(mockClient.search as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network'),
			)

			sut.searchQuery = 'fail'
			sut.onQueryChanged('fail')
			await vi.advanceTimersByTimeAsync(300)
			await vi.advanceTimersByTimeAsync(0)

			expect(mockCallbacks.onSearchCompleted).not.toHaveBeenCalled()
			// onError IS fired for the failure (existing contract).
			expect(mockCallbacks.onError).toHaveBeenCalledWith(
				'discovery.searchFailed',
			)
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
