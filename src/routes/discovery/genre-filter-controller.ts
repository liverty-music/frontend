import type { ILogger } from 'aurelia'
import type { IArtistBubbleStore } from '../../services/artist-bubble-store'
import { detectCountryFromTimezone } from '../../util/detect-country'

export interface GenreFilterCallbacks {
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

/**
 * Owns the genre-chip selection state and drives the field owner to reload the
 * field for a tag (or back to the regional top on toggle-off). It applies NO
 * bubble invariants itself — the store's single `setField` boundary handles
 * dedup / followed-exclusion / cap, and the field→canvas binding reconciles the
 * physics. The controller only fetches through the store.
 */
export class GenreFilterController {
	public readonly genreTags = GENRE_TAGS
	public activeTag = ''
	public isLoadingTag = false

	constructor(
		private readonly store: IArtistBubbleStore,
		private readonly callbacks: GenreFilterCallbacks,
		private readonly logger: ILogger,
		private readonly abortSignal: () => AbortSignal,
	) {}

	/**
	 * Clear the active genre selection without reloading. The caller is
	 * responsible for re-seeding the field (e.g. the discovery reset flow).
	 */
	public clearActiveTag(): void {
		this.activeTag = ''
	}

	public async onGenreSelected(tag: string): Promise<void> {
		if (this.isLoadingTag) return

		if (this.activeTag === tag) {
			this.activeTag = ''
			this.isLoadingTag = true
			try {
				// Country is not passed for tags; back to the regional top on toggle-off.
				await this.store.loadTop(detectCountryFromTimezone(), '')
			} catch (err) {
				if (this.abortSignal().aborted) return
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
			// The upstream API does not support tag + country, so tags fetch globally.
			await this.store.loadTop('', tag.toLowerCase())
		} catch (err) {
			this.activeTag = ''
			if (this.abortSignal().aborted) return
			this.logger.warn('Failed to load genre artists', err)
			this.callbacks.onError('discovery.genreLoadFailed', { tag })
		} finally {
			this.isLoadingTag = false
		}
	}
}
