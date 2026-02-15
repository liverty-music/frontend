import { DI, ILogger, resolve } from 'aurelia'
import { IArtistDiscoveryService } from './artist-discovery-service'
import { IConcertService } from './concert-service'

export const ILoadingSequenceService = DI.createInterface<ILoadingSequenceService>(
	'ILoadingSequenceService',
	(x) => x.singleton(LoadingSequenceService),
)

export interface ILoadingSequenceService extends LoadingSequenceService {}

const GLOBAL_TIMEOUT_MS = 10000
const MINIMUM_DISPLAY_MS = 3000
const BATCH_SIZE = 5

export class LoadingSequenceService {
	private readonly artistDiscoveryService = resolve(IArtistDiscoveryService)
	private readonly concertService = resolve(IConcertService)
	private readonly logger = resolve(ILogger).scopeTo('LoadingSequenceService')

	public async aggregateData(): Promise<void> {
		const startTime = Date.now()

		const abortController = new AbortController()
		const timeoutId = setTimeout(() => {
			this.logger.warn('Global timeout reached, aborting remaining searches')
			abortController.abort()
		}, GLOBAL_TIMEOUT_MS)

		try {
			// Get followed artists with retry logic
			const followedArtists =
				await this.getFollowedArtistsWithRetry(abortController.signal)

			if (followedArtists.length === 0) {
				this.logger.info('No followed artists found, skipping concert search')
				return
			}

			// Search concerts in batches
			await this.searchConcertsInBatches(
				followedArtists,
				abortController.signal,
			)

			// Ensure minimum display duration
			const elapsed = Date.now() - startTime
			const remaining = MINIMUM_DISPLAY_MS - elapsed
			if (remaining > 0) {
				this.logger.info('Waiting for minimum display duration', {
					remaining,
				})
				await this.delay(remaining)
			}
		} catch (err) {
			this.logger.error('Data aggregation failed', err)
			// Gracefully proceed to dashboard even on error
		} finally {
			clearTimeout(timeoutId)
		}
	}

	private async getFollowedArtistsWithRetry(
		signal: AbortSignal,
	): Promise<Array<{ id: string; name: string }>> {
		const maxRetries = 1
		let attempt = 0

		while (attempt <= maxRetries) {
			try {
				this.logger.info('Fetching followed artists', { attempt })
				const followed = await this.artistDiscoveryService.listFollowedFromBackend(signal)
				const artists = followed.map(
					(a) => ({
						id: a.id,
						name: a.name,
					}),
				)
				this.logger.info('Followed artists retrieved', {
					count: artists.length,
				})
				return artists
			} catch (err) {
				attempt++
				if (attempt > maxRetries) {
					this.logger.error('Failed to fetch followed artists after retries', err)
					throw err
				}
				this.logger.warn('Retrying followed artists fetch', { attempt })
				await this.delay(500, signal)
			}
		}

		return []
	}

	private async searchConcertsInBatches(
		artists: Array<{ id: string; name: string }>,
		signal: AbortSignal,
	): Promise<void> {
		this.logger.info('Starting concert searches', {
			totalArtists: artists.length,
		})

		// Process in batches of BATCH_SIZE sequentially
		for (let i = 0; i < artists.length; i += BATCH_SIZE) {
			if (signal.aborted) break
			const batch = artists.slice(i, i + BATCH_SIZE)
			this.logger.info('Processing batch', {
				batchIndex: i / BATCH_SIZE,
				batchSize: batch.length,
			})

			// Within each batch, run searches in parallel
			const promises = batch.map((artist) =>
				this.concertService
					.searchNewConcerts(artist.id, signal)
					.catch((err) => {
						this.logger.warn('Concert search failed for artist', {
							artistId: artist.id,
							artistName: artist.name,
							error: err,
						})
						return null
					}),
			)

			await Promise.allSettled(promises)
		}

		this.logger.info('All concert searches completed')
	}

	private delay(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(resolve, ms)
			signal?.addEventListener('abort', () => {
				clearTimeout(timeoutId)
				reject(new Error('Aborted'))
			}, { once: true })
		})
	}
}
