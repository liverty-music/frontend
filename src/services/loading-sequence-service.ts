import { SearchStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import { IArtistServiceClient } from './artist-service-client'
import { IConcertService } from './concert-service'

export const ILoadingSequenceService =
	DI.createInterface<ILoadingSequenceService>('ILoadingSequenceService', (x) =>
		x.singleton(LoadingSequenceService),
	)

export interface ILoadingSequenceService extends LoadingSequenceService {}

export type AggregationResult =
	| { status: 'success' }
	| { status: 'partial'; failedCount: number; totalCount: number }
	| { status: 'failed'; error: unknown }

const GLOBAL_TIMEOUT_MS = 45_000
const MINIMUM_DISPLAY_MS = 3000
const POLL_INTERVAL_MS = 3000

export class LoadingSequenceService {
	private readonly artistClient = resolve(IArtistServiceClient)
	private readonly concertService = resolve(IConcertService)
	private readonly logger = resolve(ILogger).scopeTo('LoadingSequenceService')

	public completedCount = 0
	public totalCount = 0

	public async aggregateData(): Promise<AggregationResult> {
		const startTime = Date.now()

		const abortController = new AbortController()
		const timeoutId = setTimeout(() => {
			this.logger.warn('Global timeout reached, aborting remaining searches')
			abortController.abort()
		}, GLOBAL_TIMEOUT_MS)

		try {
			// Get followed artists with retry logic
			const followedArtists = await this.getFollowedArtistsWithRetry(
				abortController.signal,
			)

			if (followedArtists.length === 0) {
				this.logger.info('No followed artists found, skipping concert search')
				return { status: 'success' }
			}

			this.totalCount = followedArtists.length
			const artistIds = followedArtists.map((a) => a.id)

			// Fire-and-forget: enqueue all searches (no await needed)
			for (const artist of followedArtists) {
				this.concertService
					.searchNewConcerts(artist.id, abortController.signal)
					.catch((err) => {
						this.logger.warn('SearchNewConcerts fire-and-forget failed', {
							artistId: artist.id,
							error: err,
						})
					})
			}

			// Poll ListSearchStatuses until all terminal or aborted
			const failedCount = await this.pollSearchStatuses(
				artistIds,
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

			if (failedCount > 0) {
				return {
					status: 'partial',
					failedCount,
					totalCount: followedArtists.length,
				}
			}
			return { status: 'success' }
		} catch (err) {
			this.logger.error('Data aggregation failed', err)
			return { status: 'failed', error: err }
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
				const followed = await this.artistClient.listFollowedAsBubbles(signal)
				const artists = followed.map((a) => ({
					id: a.id,
					name: a.name,
				}))
				this.logger.info('Followed artists retrieved', {
					count: artists.length,
				})
				return artists
			} catch (err) {
				attempt++
				if (attempt > maxRetries) {
					this.logger.error(
						'Failed to fetch followed artists after retries',
						err,
					)
					throw err
				}
				this.logger.warn('Retrying followed artists fetch', { attempt })
				await this.delay(500, signal)
			}
		}

		return []
	}

	private async pollSearchStatuses(
		artistIds: string[],
		signal: AbortSignal,
	): Promise<number> {
		this.logger.info('Starting status polling', {
			artistCount: artistIds.length,
		})

		let lastCompleted = 0
		let lastFailed = 0

		while (!signal.aborted) {
			await this.delay(POLL_INTERVAL_MS, signal).catch(() => {
				// Abort during delay is expected
			})

			if (signal.aborted) break

			try {
				const statuses = await this.concertService.listSearchStatuses(
					artistIds,
					signal,
				)

				let completed = 0
				let failed = 0

				for (const s of statuses) {
					if (s.status === SearchStatus.COMPLETED) {
						completed++
					} else if (s.status === SearchStatus.FAILED) {
						failed++
					}
				}

				lastCompleted = completed
				lastFailed = failed
				this.completedCount = completed + failed
				this.logger.info('Poll result', {
					completed,
					failed,
					pending: artistIds.length - completed - failed,
				})

				if (completed + failed >= artistIds.length) {
					this.logger.info('All searches terminal', { completed, failed })
					return failed
				}
			} catch (err) {
				if (signal.aborted) break
				this.logger.warn('Poll failed, will retry', { error: err })
			}
		}

		// Aborted (timeout) — treat pending artists as failures
		const nonTerminal = artistIds.length - lastCompleted - lastFailed
		this.logger.warn('Polling aborted, proceeding with available data', {
			lastCompleted,
			lastFailed,
			nonTerminal,
		})
		return lastFailed + nonTerminal
	}

	private delay(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				return reject(new Error('Aborted'))
			}

			const onAbort = () => {
				clearTimeout(timeoutId)
				reject(new Error('Aborted'))
			}

			const timeoutId = setTimeout(() => {
				signal?.removeEventListener('abort', onAbort)
				resolve()
			}, ms)

			signal?.addEventListener('abort', onAbort, { once: true })
		})
	}
}
