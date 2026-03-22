import type { ILogger } from 'aurelia'
import type { Artist } from '../../entities/artist'
import { BubblePool } from '../../services/bubble-pool'
import { detectCountryFromTimezone } from '../../util/detect-country'

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
				await this.reloadByCountry(detectCountryFromTimezone())
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
			await this.reloadByTag(tag.toLowerCase())
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

	// Fetch global top artists for a genre tag.
	// Country is not passed — the upstream API does not support tag + country.
	private async reloadByTag(tag: string): Promise<void> {
		this.logger.info('Reloading artists by tag', { tag })
		await this.fetchAndReplace('', tag)
	}

	// Fetch regional top artists for a country.
	private async reloadByCountry(country: string): Promise<void> {
		this.logger.info('Reloading artists by country', { country })
		await this.fetchAndReplace(country, '')
	}

	private async fetchAndReplace(country: string, tag: string): Promise<void> {
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
	}
}
