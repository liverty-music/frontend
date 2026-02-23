import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import type { PromiseClient } from '@connectrpc/connect'
import { createPromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IToastService } from '../components/toast-notification/toast-notification'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export interface ArtistBubble {
	id: string
	name: string
	mbid: string
	imageUrl: string
	x: number
	y: number
	radius: number
}

export const IArtistDiscoveryService =
	DI.createInterface<IArtistDiscoveryService>('IArtistDiscoveryService', (x) =>
		x.singleton(ArtistDiscoveryService),
	)

export interface IArtistDiscoveryService extends ArtistDiscoveryService {}

export class ArtistDiscoveryService {
	private readonly logger = resolve(ILogger).scopeTo('ArtistDiscoveryService')
	private readonly toast = resolve(IToastService)
	private readonly artistClient: PromiseClient<typeof ArtistService>

	constructor() {
		const authService = resolve(IAuthService)
		this.artistClient = createPromiseClient(
			ArtistService,
			createTransport(authService, resolve(ILogger).scopeTo('Transport')),
		)
	}

	public availableBubbles: ArtistBubble[] = []
	public followedArtists: ArtistBubble[] = []
	public orbIntensity = 0
	public maxBubbles = 0

	private readonly seenArtistNames = new Set<string>()
	private readonly seenArtistIds = new Set<string>()
	private readonly seenArtistMbids = new Set<string>()
	private readonly followedIds = new Set<string>()

	public async loadInitialArtists(country = 'Japan', tag = ''): Promise<void> {
		this.logger.info('Loading initial artists', { country, tag })
		this.clearSeenSets()
		for (const f of this.followedArtists) {
			this.trackSeen(f)
		}
		// NOTE: `tag` field requires BSR proto publish (specification#73).
		// Once ListTopRequest includes `tag`, add it to the request object.
		const resp = await this.artistClient.listTop({ country })
		const bubbles = resp.artists
			.map((a) => this.toBubble(a))
			.filter((b) => !this.isSeen(b))
		this.availableBubbles = bubbles
		this.maxBubbles = bubbles.length
		for (const b of this.availableBubbles) {
			this.trackSeen(b)
		}
		this.logger.info('Loaded initial artists', {
			count: this.availableBubbles.length,
			maxBubbles: this.maxBubbles,
		})
	}

	public async reloadWithTag(tag: string, country = 'Japan'): Promise<void> {
		this.logger.info('Reloading artists with tag', { tag, country })
		this.clearSeenSets()
		for (const f of this.followedArtists) {
			this.trackSeen(f)
		}
		// NOTE: `tag` field requires BSR proto publish (specification#73).
		const resp = await this.artistClient.listTop({ country })
		const bubbles = resp.artists
			.map((a) => this.toBubble(a))
			.filter((b) => !this.isSeen(b))
		this.availableBubbles = bubbles
		this.maxBubbles = bubbles.length
		for (const b of this.availableBubbles) {
			this.trackSeen(b)
		}
		this.logger.info('Reloaded artists with tag', {
			tag,
			count: this.availableBubbles.length,
			maxBubbles: this.maxBubbles,
		})
	}

	public async searchArtists(query: string): Promise<ArtistBubble[]> {
		this.logger.info('Searching artists', { query })
		const resp = await this.artistClient.search({ query })
		return resp.artists.map((a) => this.toBubble(a))
	}

	public isFollowed(artistId: string): boolean {
		return this.followedIds.has(artistId)
	}

	public async followArtist(artist: ArtistBubble): Promise<void> {
		if (this.isFollowed(artist.id)) return
		this.logger.info('Following artist', { artist: artist.name })

		// Optimistic UI update
		this.availableBubbles = this.availableBubbles.filter(
			(b) => b.id !== artist.id,
		)
		this.followedIds.add(artist.id)
		this.followedArtists.push(artist)
		this.orbIntensity = Math.min(1, this.followedArtists.length / 20)

		// Persist follow to backend with 1 retry
		const req = { artistId: new ArtistId({ value: artist.id }) }
		try {
			await this.artistClient.follow(req)
			this.logger.info('Artist followed', {
				followed: this.followedArtists.length,
				orbIntensity: this.orbIntensity,
			})
		} catch (firstErr) {
			this.logger.warn('Follow failed, retrying', {
				artist: artist.name,
				error: firstErr,
			})
			try {
				await this.artistClient.follow(req)
				this.logger.info('Artist followed on retry', {
					artist: artist.name,
				})
			} catch (retryErr) {
				this.logger.error('Failed to follow artist after retry', retryErr)

				// Rollback optimistic update
				this.followedArtists = this.followedArtists.filter(
					(b) => b.id !== artist.id,
				)
				this.followedIds.delete(artist.id)
				this.availableBubbles.push(artist)
				this.orbIntensity = Math.min(1, this.followedArtists.length / 20)

				this.toast.show(`Failed to follow ${artist.name}`)
				throw retryErr
			}
		}
	}

	public async getSimilarArtists(
		artistName: string,
		artistId: string,
	): Promise<ArtistBubble[]> {
		this.logger.info('Getting similar artists', { artistName, artistId })

		const resp = await this.artistClient.listSimilar({
			artistId: new ArtistId({ value: artistId }),
		})

		const newBubbles = resp.artists
			.map((a) => this.toBubble(a))
			.filter((b) => !this.isSeen(b))

		for (const b of newBubbles) {
			this.trackSeen(b)
			this.availableBubbles.push(b)
		}

		return newBubbles
	}

	public evictOldest(count: number): ArtistBubble[] {
		if (count <= 0) return []
		const evicted = this.availableBubbles.splice(0, count)
		return evicted
	}

	public async checkLiveEvents(artistName: string): Promise<boolean> {
		this.logger.info('Checking live events', { artistName })
		// TODO: Call backend ConcertService.List via Connect-RPC when TS clients are generated
		// For now, simulate — return true for ~30% of artists to demonstrate the toast
		const hash = Array.from(artistName).reduce(
			(acc, c) => acc + c.charCodeAt(0),
			0,
		)
		return hash % 3 === 0
	}

	public async listFollowedFromBackend(
		signal?: AbortSignal,
	): Promise<ArtistBubble[]> {
		this.logger.info('Fetching followed artists from backend')
		try {
			const resp = await this.artistClient.listFollowed({}, { signal })
			const bubbles = resp.artists.flatMap((fa) =>
				fa.artist ? [this.toBubble(fa.artist)] : [],
			)
			this.logger.info('Followed artists fetched', {
				count: bubbles.length,
			})
			return bubbles
		} catch (err) {
			this.logger.error('Failed to fetch followed artists', err)
			throw err
		}
	}

	private normalizeName(name: string): string {
		return name.trim().replace(/\s+/g, ' ').toLowerCase()
	}

	private isSeen(bubble: ArtistBubble): boolean {
		if (this.seenArtistNames.has(this.normalizeName(bubble.name))) return true
		if (bubble.id && this.seenArtistIds.has(bubble.id)) return true
		if (bubble.mbid && this.seenArtistMbids.has(bubble.mbid)) return true
		return false
	}

	private trackSeen(bubble: ArtistBubble): void {
		this.seenArtistNames.add(this.normalizeName(bubble.name))
		if (bubble.id) this.seenArtistIds.add(bubble.id)
		if (bubble.mbid) this.seenArtistMbids.add(bubble.mbid)
	}

	private clearSeenSets(): void {
		this.seenArtistNames.clear()
		this.seenArtistIds.clear()
		this.seenArtistMbids.clear()
	}

	private toBubble(artist: {
		id?: { value: string }
		name?: { value: string }
		mbid?: { value: string }
	}): ArtistBubble {
		const id = artist.id?.value ?? ''
		const name = artist.name?.value ?? ''
		const mbid = artist.mbid?.value ?? ''
		return {
			id: id || mbid || crypto.randomUUID(),
			name,
			mbid,
			imageUrl: '',
			x: 0,
			y: 0,
			radius: 30 + Math.random() * 15,
		}
	}
}
