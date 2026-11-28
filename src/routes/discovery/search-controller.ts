import type { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { type IEventAggregator, type ILogger, observable } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import type { Artist } from '../../entities/artist'

export interface SearchClient {
	search(query: string, signal: AbortSignal): Promise<Artist[]>
}

export interface SearchControllerCallbacks {
	onEnterSearchMode(): void
	onExitSearchMode(): void
	/**
	 * Called once per answered search (NotFound answers with no artists), after
	 * the result set is assigned. Carries the fields the artist.search analytics
	 * event needs. NOT called for cancelled or failed searches — analytics MUST
	 * only fire on actual completions so the search-quality funnel is not
	 * polluted by aborted attempts.
	 */
	onSearchCompleted(detail: { queryLength: number; resultCount: number }): void
}

/**
 * Where the current query stands:
 * - `idle`: nothing to search (empty, or a single half-width letter or digit)
 * - `waiting`: searchable, not sent yet
 * - `searching`: the request is outstanding
 * - `answered`: a response, or NotFound
 * - `failed`: any other failure
 */
export type SearchPhase =
	| 'idle'
	| 'waiting'
	| 'searching'
	| 'answered'
	| 'failed'

/** A single half-width Latin letter or digit matches too many artists. */
const TOO_BROAD = /^[A-Za-z0-9]$/

/** One failure snack at a time: a new one takes the place of the last. */
const FAILURE_SNACK_KEY = 'discovery-search-failed'

/**
 * Discovery's artist search. The search bar edits `searchQuery` and says when
 * to send it (`submit` after a pause in typing, `searchNow` on Enter). A change
 * of the trimmed query cancels the search being answered, so nothing it returns
 * or fails with reaches the screen.
 */
export class SearchController {
	@observable public searchQuery = ''
	public isSearchMode = false
	public searchResults: Artist[] = []
	public phase: SearchPhase = 'idle'

	/** The trimmed query the phase belongs to. */
	private query = ''
	/** The outstanding request; aborted when the fan moves past it. */
	private request: AbortController | null = null

	constructor(
		private readonly client: SearchClient,
		private readonly ea: Pick<IEventAggregator, 'publish'>,
		private readonly i18n: Pick<I18N, 'tr'>,
		private readonly callbacks: SearchControllerCallbacks,
		private readonly logger: ILogger,
	) {}

	protected searchQueryChanged(newValue: string): void {
		const query = newValue.trim()
		// White space around the query changes nothing that is searched.
		if (query === this.query) return
		this.query = query
		this.cancel()

		if (query === '') {
			this.phase = 'idle'
			this.searchResults = []
			this.isSearchMode = false
			this.callbacks.onExitSearchMode()
			return
		}

		if (TOO_BROAD.test(query)) {
			this.phase = 'idle'
			this.searchResults = []
		} else {
			// The results already shown stay until this query is answered.
			this.phase = 'waiting'
		}
		this.isSearchMode = true
		this.callbacks.onEnterSearchMode()
	}

	/** The fan paused typing: send the query if it has not been sent. */
	public submit(): void {
		if (this.phase === 'waiting') void this.send()
	}

	/** The fan pressed Enter: also sends a failed query again. */
	public searchNow(): void {
		if (this.phase === 'waiting' || this.phase === 'failed') void this.send()
	}

	public clearSearch(): void {
		this.searchQuery = ''
	}

	/** The fan left Discovery: nothing more is sent or shown. */
	public dispose(): void {
		this.cancel()
		this.phase = 'idle'
	}

	private cancel(): void {
		this.request?.abort()
		this.request = null
	}

	private async send(): Promise<void> {
		const query = this.query
		const request = new AbortController()
		this.request = request
		this.phase = 'searching'
		this.logger.info('Searching artists', { query })

		let results: Artist[]
		try {
			results = await this.client.search(query, request.signal)
		} catch (err) {
			if (request.signal.aborted) return
			// NotFound is an answer: no artist matches.
			if (!(err instanceof ConnectError && err.code === Code.NotFound)) {
				this.logger.warn('Search failed', err)
				this.searchResults = []
				this.phase = 'failed'
				this.ea.publish(
					new Snack(this.i18n.tr('discovery.searchFailed'), 'warning', {
						replaceKey: FAILURE_SNACK_KEY,
					}),
				)
				return
			}
			results = []
		}
		if (request.signal.aborted) return

		this.searchResults = results
		this.phase = 'answered'
		this.callbacks.onSearchCompleted({
			queryLength: query.length,
			resultCount: results.length,
		})
	}
}
