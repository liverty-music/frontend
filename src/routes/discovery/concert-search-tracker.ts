import type { ILogger } from 'aurelia'

export interface ConcertSearchClient {
	searchNewConcerts(artistId: string): Promise<void>
	listByFollower(signal?: AbortSignal): Promise<unknown[]>
}

export interface ConcertSearchCallbacks {
	onAllSearchesComplete(): void
}

export class ConcertSearchTracker {
	public completedSearchCount = 0
	public concertGroupCount = -1

	private readonly searchStatus = new Map<string, 'pending' | 'done'>()
	private readonly searchTimeouts = new Set<number>()

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

		const timeout = window.setTimeout(() => {
			this.searchTimeouts.delete(timeout)
			this.markSearchDone(artistId)
		}, 15_000)
		this.searchTimeouts.add(timeout)

		this.concertClient
			.searchNewConcerts(artistId)
			.then(() => {
				window.clearTimeout(timeout)
				this.searchTimeouts.delete(timeout)
				this.markSearchDone(artistId)
			})
			.catch((err) => {
				window.clearTimeout(timeout)
				this.searchTimeouts.delete(timeout)
				this.logger.warn('Background concert search failed', {
					artistId,
					error: err,
				})
				this.markSearchDone(artistId)
			})
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
		for (const t of this.searchTimeouts) window.clearTimeout(t)
		this.searchTimeouts.clear()
	}

	private markSearchDone(artistId: string): void {
		if (this.searchStatus.get(artistId) === 'done') return
		this.searchStatus.set(artistId, 'done')
		this.completedSearchCount = [...this.searchStatus.values()].filter(
			(s) => s === 'done',
		).length

		if (this.allSearchesComplete) {
			void this.verifyConcertData()
		}
	}

	private async verifyConcertData(): Promise<void> {
		try {
			const groups = await this.concertClient.listByFollower(this.abortSignal())
			if (this.abortSignal().aborted) return
			this.concertGroupCount = groups.length
			this.logger.info('Concert data verified', {
				groupCount: this.concertGroupCount,
			})
			this.callbacks.onAllSearchesComplete()
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Failed to verify concert data', { error: err })
			this.concertGroupCount = 0
		}
	}
}
