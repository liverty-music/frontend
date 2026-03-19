import type { ILogger } from 'aurelia'
import type { Artist } from '../../entities/artist'
import { BubblePool } from '../../services/bubble-pool'

export interface GenreArtistClient {
	listTop(country: string, tag: string, limit: number): Promise<Artist[]>
}

export interface GenreFilterCallbacks {
	onBubblesReloaded(artists: Artist[]): void
	onError(messageKey: string, params?: Record<string, string>): void
}

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

export class GenreFilterController {
	public readonly genreTags = GENRE_TAGS
	public activeTag = ''
	public isLoadingTag = false

	constructor(
		private readonly client: GenreArtistClient,
		private readonly pool: BubblePool,
		private readonly followedArtists: () => Artist[],
		private readonly callbacks: GenreFilterCallbacks,
		private readonly logger: ILogger,
		private readonly abortSignal: () => AbortSignal,
	) {}

	public async onGenreSelected(tag: string): Promise<void> {
		if (this.isLoadingTag) return

		if (this.activeTag === tag) {
			this.activeTag = ''
			this.isLoadingTag = true
			try {
				await this.reloadWithTag('')
				if (this.abortSignal().aborted) return
				this.callbacks.onBubblesReloaded(this.pool.availableBubbles)
			} catch (err) {
				this.logger.error('Failed to clear genre tag', err)
				this.callbacks.onError('discovery.resetFailed')
			} finally {
				this.isLoadingTag = false
			}
			return
		}

		this.activeTag = tag
		this.isLoadingTag = true
		this.logger.info('Genre selected', { tag })

		try {
			await this.reloadWithTag(tag.toLowerCase())
			if (this.abortSignal().aborted) return
			this.callbacks.onBubblesReloaded(this.pool.availableBubbles)
		} catch (err) {
			this.activeTag = ''
			this.logger.warn('Failed to load genre artists', err)
			this.callbacks.onError('discovery.genreLoadFailed', { tag })
		} finally {
			this.isLoadingTag = false
		}
	}

	private async reloadWithTag(tag: string, country = 'Japan'): Promise<void> {
		this.logger.info('Reloading artists with tag', { tag, country })
		this.pool.clearSeenSets()
		this.pool.trackAllSeen(this.followedArtists())

		const rawArtists = await this.client.listTop(
			country,
			tag,
			BubblePool.MAX_BUBBLES,
		)
		const followedIds = new Set(this.followedArtists().map((a) => a.id))
		const artists = this.pool
			.dedup(rawArtists, followedIds)
			.slice(0, BubblePool.MAX_BUBBLES)

		this.pool.replace(artists)
		this.pool.trackAllSeen(artists)

		this.logger.info('Reloaded artists with tag', {
			tag,
			count: this.pool.availableBubbles.length,
		})
	}
}
