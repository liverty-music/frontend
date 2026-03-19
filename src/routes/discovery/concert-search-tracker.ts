import type { ILogger } from 'aurelia'

export interface SearchStatusResult {
	artistId: string
	status: 'unspecified' | 'pending' | 'completed' | 'failed'
}

export interface ConcertSearchClient {
	searchNewConcerts(artistId: string): Promise<void>
	listSearchStatuses(
		artistIds: string[],
		signal?: AbortSignal,
	): Promise<SearchStatusResult[]>
	verifyConcertsExist(
		artistIds: string[],
		signal?: AbortSignal,
	): Promise<boolean>
}

export interface ConcertSearchCallbacks {
	onAllSearchesComplete(): void
}

const POLL_INTERVAL_MS = 2_000
const PER_ARTIST_TIMEOUT_MS = 15_000

export class ConcertSearchTracker {
	public completedSearchCount = 0
	public concertGroupCount = -1

	private readonly searchStatus = new Map<string, 'pending' | 'done'>()
	private readonly searchStartTimes = new Map<string, number>()
	private pollIntervalId: number | undefined

	constructor(
		private readonly concertClient: ConcertSearchClient,
		private readonly callbacks: ConcertSearchCallbacks,
		private readonly logger: ILogger,
		private readonly abortSignal: () => AbortSignal,
		private readonly followedCount: () => number,
		private readonly tutorialFollowTarget: number,
	) {}

	public searchConcertsWithTimeout(artistId: string): void {
		if (this.searchStatus.has(artistId)) return
		this.searchStatus.set(artistId, 'pending')
		this.searchStartTimes.set(artistId, Date.now())

		// Fire-and-forget: initiate backend search, don't use RPC return as completion signal
		this.concertClient.searchNewConcerts(artistId).catch((err) => {
			this.logger.warn('Background concert search failed', {
				artistId,
				error: err,
			})
		})

		this.startPollingIfNeeded()
	}

	public get allSearchesComplete(): boolean {
		const count = this.followedCount()
		return (
			count >= this.tutorialFollowTarget && this.completedSearchCount >= count
		)
	}

	public get showDashboardCoachMark(): boolean {
		return this.allSearchesComplete && this.concertGroupCount > 0
	}

	public syncPreSeeded(follows: { artistId: string }[]): void {
		for (const artist of follows) {
			if (!this.searchStatus.has(artist.artistId)) {
				this.searchConcertsWithTimeout(artist.artistId)
			}
		}
	}

	public dispose(): void {
		this.stopPolling()
	}

	private startPollingIfNeeded(): void {
		if (this.pollIntervalId !== undefined) return
		this.pollIntervalId = window.setInterval(
			() => void this.pollSearchStatuses(),
			POLL_INTERVAL_MS,
		)
	}

	private stopPolling(): void {
		if (this.pollIntervalId !== undefined) {
			window.clearInterval(this.pollIntervalId)
			this.pollIntervalId = undefined
		}
	}

	private async pollSearchStatuses(): Promise<void> {
		const now = Date.now()
		const pendingIds = this.getPendingArtistIds()

		// Apply per-artist timeout first
		for (const artistId of pendingIds) {
			const startTime = this.searchStartTimes.get(artistId) ?? now
			if (now - startTime >= PER_ARTIST_TIMEOUT_MS) {
				this.logger.info('Search polling timed out for artist', { artistId })
				this.markSearchDone(artistId)
			}
		}

		// Re-check pending after timeout processing
		const stillPending = this.getPendingArtistIds()
		if (stillPending.length === 0) {
			this.stopPolling()
			if (this.allSearchesComplete) {
				void this.verifyConcertData()
			}
			return
		}

		try {
			const statuses = await this.concertClient.listSearchStatuses(
				stillPending,
				this.abortSignal(),
			)
			if (this.abortSignal().aborted) return

			for (const s of statuses) {
				if (s.status === 'completed' || s.status === 'failed') {
					this.markSearchDone(s.artistId)
				}
			}
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('ListSearchStatuses poll failed, will retry', {
				error: err,
			})
			return
		}

		if (this.getPendingArtistIds().length === 0) {
			this.stopPolling()
			if (this.allSearchesComplete) {
				void this.verifyConcertData()
			}
		}
	}

	private getPendingArtistIds(): string[] {
		const pending: string[] = []
		for (const [artistId, status] of this.searchStatus) {
			if (status === 'pending') pending.push(artistId)
		}
		return pending
	}

	private markSearchDone(artistId: string): void {
		if (this.searchStatus.get(artistId) === 'done') return
		this.searchStatus.set(artistId, 'done')
		this.completedSearchCount = [...this.searchStatus.values()].filter(
			(s) => s === 'done',
		).length
	}

	private async verifyConcertData(): Promise<void> {
		const artistIds = [...this.searchStatus.keys()]
		try {
			const exists = await this.concertClient.verifyConcertsExist(
				artistIds,
				this.abortSignal(),
			)
			if (this.abortSignal().aborted) return
			this.concertGroupCount = exists ? 1 : 0
			this.logger.info('Concert data verified', {
				concertsExist: exists,
			})
			this.callbacks.onAllSearchesComplete()
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Failed to verify concert data', { error: err })
			this.concertGroupCount = 0
		}
	}
}
