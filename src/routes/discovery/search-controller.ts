import type { ILogger } from 'aurelia'
import type { Artist } from '../../entities/artist'

export interface SearchClient {
	search(query: string): Promise<Artist[]>
}

export interface SearchControllerCallbacks {
	onEnterSearchMode(): void
	onExitSearchMode(): void
	onError(message: string): void
	/**
	 * Called once per successful, non-stale search after the result set is
	 * assigned. Carries the fields the artist.search analytics event needs
	 * (query_length, result_count). NOT called for stale-query early returns
	 * or thrown searches — analytics MUST only fire on actual completions
	 * so the search-quality funnel is not polluted by aborted attempts.
	 */
	onSearchCompleted(detail: { queryLength: number; resultCount: number }): void
}

export class SearchController {
	public searchQuery = ''
	public isSearchMode = false
	public searchResults: Artist[] = []
	public isSearching = false

	private debounceTimer = 0

	constructor(
		private readonly client: SearchClient,
		private readonly callbacks: SearchControllerCallbacks,
		private readonly logger: ILogger,
	) {}

	public onQueryChanged(newValue: string): void {
		window.clearTimeout(this.debounceTimer)
		const query = newValue.trim()

		if (query.length === 0) {
			this.exitSearchMode()
			return
		}

		this.isSearchMode = true
		this.callbacks.onEnterSearchMode()
		this.debounceTimer = window.setTimeout(() => {
			void this.performSearch(query)
		}, 300)
	}

	public clearSearch(): void {
		this.searchQuery = ''
	}

	public exitSearchMode(): void {
		this.isSearchMode = false
		this.searchResults = []
		this.isSearching = false
		this.callbacks.onExitSearchMode()
	}

	public dispose(): void {
		window.clearTimeout(this.debounceTimer)
	}

	private async performSearch(query: string): Promise<void> {
		if (query.length < 1) return

		this.isSearching = true
		this.logger.info('Searching artists', { query })

		try {
			const results = await this.client.search(query)
			if (this.searchQuery.trim() !== query) return
			this.searchResults = results
			this.callbacks.onSearchCompleted({
				queryLength: query.length,
				resultCount: results.length,
			})
		} catch (err) {
			this.logger.warn('Search failed', err)
			this.callbacks.onError('discovery.searchFailed')
			this.searchResults = []
		} finally {
			if (this.searchQuery.trim() === query) {
				this.isSearching = false
			}
		}
	}
}
