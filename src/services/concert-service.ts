import { SearchStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	IConcertRpcClient,
	type ProtoConcert,
	type ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { codeToHome } from '../constants/iso3166'
import { IAuthService } from './auth-service'
import { IGuestService } from './guest-service'

export type { ProtoConcert, ProximityGroup }

export interface SearchStatusResult {
	artistId: string
	status: 'unspecified' | 'pending' | 'completed' | 'failed'
}

const POLL_INTERVAL_MS = 2_000
const PER_ARTIST_TIMEOUT_MS = 15_000

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly authService = resolve(IAuthService)
	private readonly guest = resolve(IGuestService)
	private readonly rpcClient = resolve(IConcertRpcClient)

	// --- Concert search tracking state ---
	@observable public artistsWithConcerts = new Set<string>()
	private readonly searchStatus = new Map<string, 'pending' | 'done'>()
	private readonly searchStartTimes = new Map<string, number>()
	private pollIntervalId: number | undefined
	private pollAbortSignal: AbortSignal | undefined
	private pollTargetCount = 3
	private onConcertFoundCallback?: (artistId: string) => void

	public get artistsWithConcertsCount(): number {
		return this.artistsWithConcerts.size
	}

	// --- Search and track lifecycle ---

	/**
	 * Initiate a background concert search for an artist and track its completion.
	 * When the search completes, checks if the artist has concerts and updates
	 * artistsWithConcerts. Stops polling early when targetCount is reached.
	 */
	public searchAndTrack(
		artistId: string,
		signal: AbortSignal,
		targetCount: number,
		onConcertFound?: (artistId: string) => void,
	): void {
		if (this.searchStatus.has(artistId)) return
		this.searchStatus.set(artistId, 'pending')
		this.searchStartTimes.set(artistId, Date.now())
		this.pollAbortSignal = signal
		this.pollTargetCount = targetCount
		this.onConcertFoundCallback = onConcertFound

		// Fire-and-forget: initiate backend search
		this.rpcClient.searchNewConcerts(artistId).catch((err) => {
			this.logger.warn('Background concert search failed', {
				artistId,
				error: err,
			})
		})

		this.startPollingIfNeeded()
	}

	/**
	 * Stop polling and clean up interval. Called on page detach.
	 * Retains artistsWithConcerts state.
	 */
	public stopTracking(): void {
		this.stopPolling()
	}

	// --- Existing RPC methods ---

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ProtoConcert[]> {
		return this.rpcClient.listConcerts(artistId, signal)
	}

	public async listByFollower(signal?: AbortSignal): Promise<ProximityGroup[]> {
		if (!this.authService.isAuthenticated) {
			return this.listByFollowerGuest(signal)
		}
		return this.rpcClient.listByFollower(signal)
	}

	public async searchNewConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		await this.rpcClient.searchNewConcerts(artistId, signal)
	}

	public async listSearchStatuses(
		artistIds: string[],
		signal?: AbortSignal,
	): Promise<SearchStatusResult[]> {
		const statuses = await this.rpcClient.listSearchStatuses(artistIds, signal)
		return statuses.map((s) => ({
			artistId: s.artistId?.value ?? '',
			status: protoStatusToString(s.status),
		}))
	}

	// --- Private ---

	private async listByFollowerGuest(
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const { follows, home: homeCode } = this.guest
		this.logger.info('Guest: listing concerts with proximity', {
			count: follows.length,
		})
		if (follows.length === 0 || !homeCode) return []

		const { countryCode, level1 } = codeToHome(homeCode)
		return this.rpcClient.listWithProximity(
			follows.map((a) => a.artist.id),
			countryCode,
			level1,
			signal,
		)
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
		const signal = this.pollAbortSignal
		if (signal?.aborted) {
			this.stopPolling()
			return
		}

		const now = Date.now()
		const pendingIds = this.getPendingArtistIds()

		// Apply per-artist timeout
		for (const artistId of pendingIds) {
			const startTime = this.searchStartTimes.get(artistId) ?? now
			if (now - startTime >= PER_ARTIST_TIMEOUT_MS) {
				this.logger.info('Search polling timed out for artist', { artistId })
				this.markDone(artistId)
			}
		}

		// Check early exit: target reached
		if (this.artistsWithConcerts.size >= this.pollTargetCount) {
			this.stopPolling()
			return
		}

		const stillPending = this.getPendingArtistIds()
		if (stillPending.length === 0) {
			this.stopPolling()
			return
		}

		try {
			const statuses = await this.listSearchStatuses(stillPending, signal)
			if (signal?.aborted) return

			for (const s of statuses) {
				if (s.status === 'completed') {
					this.markDone(s.artistId)
					void this.checkArtistConcerts(s.artistId, signal)
				} else if (s.status === 'failed') {
					this.markDone(s.artistId)
				}
			}
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('ListSearchStatuses poll failed, will retry', {
				error: err,
			})
			return
		}

		// Re-check after processing
		if (
			this.getPendingArtistIds().length === 0 ||
			this.artistsWithConcerts.size >= this.pollTargetCount
		) {
			this.stopPolling()
		}
	}

	private async checkArtistConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			const concerts = await this.rpcClient.listConcerts(artistId, signal)
			if (signal?.aborted) return
			if (concerts.length > 0) {
				this.artistsWithConcerts = new Set([
					...this.artistsWithConcerts,
					artistId,
				])
				this.logger.info('Artist has concerts', {
					artistId,
					concertCount: concerts.length,
					artistsWithConcerts: this.artistsWithConcerts.size,
				})
				this.onConcertFoundCallback?.(artistId)
			}
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Failed to check artist concerts', {
				artistId,
				error: err,
			})
		}
	}

	private getPendingArtistIds(): string[] {
		const pending: string[] = []
		for (const [artistId, status] of this.searchStatus) {
			if (status === 'pending') pending.push(artistId)
		}
		return pending
	}

	private markDone(artistId: string): void {
		this.searchStatus.set(artistId, 'done')
	}
}

function protoStatusToString(
	status: SearchStatus,
): SearchStatusResult['status'] {
	switch (status) {
		case SearchStatus.PENDING:
			return 'pending'
		case SearchStatus.COMPLETED:
			return 'completed'
		case SearchStatus.FAILED:
			return 'failed'
		default:
			return 'unspecified'
	}
}
