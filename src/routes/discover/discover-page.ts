import { I18N } from '@aurelia/i18n'
import { ILogger, resolve, shadowCSS, useShadowDOM, watch } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { IToastService } from '../../components/toast-notification/toast-notification'
import {
	type ArtistBubble,
	IArtistDiscoveryService,
} from '../../services/artist-discovery-service'
import css from './discover-page.css?raw'

const GENRE_TAGS = [
	'Rock',
	'Pop',
	'Anime',
	'Jazz',
	'Electronic',
	'Hip-Hop',
	'Metal',
	'R&B',
	'Classical',
	'Indie',
] as const

@useShadowDOM()
export class DiscoverPage {
	static dependencies = [shadowCSS(css)]

	private readonly discoveryService = resolve(IArtistDiscoveryService)
	private readonly toastService = resolve(IToastService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoverPage')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas

	public readonly genreTags = GENRE_TAGS
	public activeTag = ''
	public isLoadingTag = false

	public searchQuery = ''
	public isSearchMode = false
	public searchResults: ArtistBubble[] = []
	public isSearching = false
	private searchDebounceTimer = 0
	private abortController = new AbortController()

	public get followedCount(): number {
		return this.discoveryService.followedArtists.length
	}

	public async loading(): Promise<void> {
		this.logger.info('Loading discover page')
		try {
			await this.discoveryService.loadInitialArtists('Japan', '')
		} catch (err) {
			this.logger.error('Failed to load initial artists', err)
			this.toastService.show(this.i18n.tr('discover.loadFailed'), 'error')
		}
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)
	}

	public detaching(): void {
		this.abortController.abort()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		window.clearTimeout(this.searchDebounceTimer)
	}

	private readonly onVisibilityChange = (): void => {
		if (document.hidden) {
			this.dnaOrbCanvas?.pause()
		} else if (!this.isSearchMode) {
			this.dnaOrbCanvas?.resume()
		}
	}

	public async onGenreSelected(tag: string): Promise<void> {
		if (this.isLoadingTag) return

		if (this.activeTag === tag) {
			this.activeTag = ''
			this.isLoadingTag = true
			try {
				await this.discoveryService.reloadWithTag('')
				if (this.abortController.signal.aborted) return
				this.dnaOrbCanvas.reloadBubbles(this.discoveryService.availableBubbles)
			} catch (err) {
				this.logger.error('Failed to clear genre tag', err)
				this.toastService.show(this.i18n.tr('discover.resetFailed'), 'error')
			} finally {
				this.isLoadingTag = false
			}
			return
		}

		this.activeTag = tag
		this.isLoadingTag = true
		this.logger.info('Genre selected', { tag })

		try {
			await this.discoveryService.reloadWithTag(tag.toLowerCase())
			if (this.abortController.signal.aborted) return
			this.dnaOrbCanvas.reloadBubbles(this.discoveryService.availableBubbles)
		} catch (err) {
			this.activeTag = ''
			this.logger.warn('Failed to load genre artists', err)
			this.toastService.show(
				this.i18n.tr('discover.genreLoadFailed', { tag }),
				'error',
			)
		} finally {
			this.isLoadingTag = false
		}
	}

	@watch('searchQuery')
	protected onSearchQueryChanged(newValue: string): void {
		window.clearTimeout(this.searchDebounceTimer)
		const query = newValue.trim()

		if (query.length === 0) {
			this.exitSearchMode()
			return
		}

		this.isSearchMode = true
		this.dnaOrbCanvas?.pause()
		this.searchDebounceTimer = window.setTimeout(() => {
			void this.performSearch(query)
		}, 300)
	}

	public clearSearch(): void {
		this.searchQuery = ''
	}

	private exitSearchMode(): void {
		this.isSearchMode = false
		this.searchResults = []
		this.isSearching = false
		this.dnaOrbCanvas?.resume()
	}

	private async performSearch(query: string): Promise<void> {
		if (query.length < 1) return

		this.isSearching = true
		this.logger.info('Searching artists', { query })

		try {
			const results = await this.discoveryService.searchArtists(query)
			if (this.abortController.signal.aborted) return
			if (this.searchQuery.trim() !== query) return // stale response
			this.searchResults = results
		} catch (err) {
			this.logger.warn('Search failed', err)
			this.toastService.show(this.i18n.tr('discover.searchFailed'), 'warning')
			this.searchResults = []
		} finally {
			if (this.searchQuery.trim() === query) {
				this.isSearching = false
			}
		}
	}

	public async onArtistSelected(
		event: CustomEvent<{ artist: ArtistBubble }>,
	): Promise<void> {
		const artist = event.detail.artist
		if (this.discoveryService.isFollowed(artist.id)) return
		this.logger.info('Artist selected from bubbles', {
			artist: artist.name,
		})

		try {
			await this.discoveryService.followArtist(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})
			this.toastService.show(
				this.i18n.tr('discover.followFailed', { name: artist.name }),
				'error',
			)
			return
		}
		if (this.abortController.signal.aborted) return

		try {
			const hasEvents = await this.discoveryService.checkLiveEvents(artist.name)
			if (this.abortController.signal.aborted) return
			if (hasEvents) {
				this.toastService.show(
					this.i18n.tr('discover.hasUpcomingEvents', { name: artist.name }),
				)
			}
		} catch (err) {
			this.logger.warn('Failed to check live events', err)
		}
	}

	public async onFollowFromSearch(artist: ArtistBubble): Promise<void> {
		if (this.discoveryService.isFollowed(artist.id)) return

		this.logger.info('Following artist from search', {
			artist: artist.name,
		})

		try {
			await this.discoveryService.followArtist(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist from search', {
				artist: artist.name,
				error: err,
			})
			this.toastService.show(
				this.i18n.tr('discover.followFailed', { name: artist.name }),
				'error',
			)
			return
		}
		if (this.abortController.signal.aborted) return

		try {
			const hasEvents = await this.discoveryService.checkLiveEvents(artist.name)
			if (this.abortController.signal.aborted) return
			if (hasEvents) {
				this.toastService.show(
					this.i18n.tr('discover.hasUpcomingEvents', { name: artist.name }),
				)
			}
		} catch (err) {
			this.logger.warn('Failed to check live events', err)
		}
	}

	public isArtistFollowed(artistId: string): boolean {
		return this.discoveryService.isFollowed(artistId)
	}

	public onSimilarArtistsUnavailable(
		event: CustomEvent<{ artistName: string }>,
	): void {
		this.logger.info('No similar artists found', {
			artistName: event.detail.artistName,
		})
	}

	public onSimilarArtistsError(
		event: CustomEvent<{ artistName: string; error: unknown }>,
	): void {
		this.logger.warn('Error loading similar artists', {
			artistName: event.detail.artistName,
			error: event.detail.error,
		})
		this.toastService.show(
			this.i18n.tr('discover.similarArtistsError', {
				name: event.detail.artistName,
			}),
			'warning',
		)
	}
}
