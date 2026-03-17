import type { ILogger } from 'aurelia'
import type { ArtistBubble } from '../../services/artist-service-client'

export interface SearchClient {
	search(query: string): Promise<ArtistBubble[]>
}

export interface SearchControllerCallbacks {
	onEnterSearchMode(): void
	onExitSearchMode(): void
	onError(message: string): void
}

export class SearchController {
	public searchQuery = ''
	public isSearchMode = false
	public searchResults: ArtistBubble[] = []
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
