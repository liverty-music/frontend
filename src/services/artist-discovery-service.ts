import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import type { PromiseClient } from '@connectrpc/connect'
import { createPromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { createTransport } from './grpc-transport'
import { IAuthService } from './auth-service'

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
	private readonly artistClient: PromiseClient<typeof ArtistService>

	constructor() {
		const authService = resolve(IAuthService)
		this.artistClient = createPromiseClient(
			ArtistService,
			createTransport(authService),
		)
	}

	public availableBubbles: ArtistBubble[] = []
	public followedArtists: ArtistBubble[] = []
	public orbIntensity = 0

	private readonly seenArtistNames = new Set<string>()
	private readonly followedIds = new Set<string>()

	public async loadInitialArtists(country = 'Japan', tag = ''): Promise<void> {
		this.logger.info('Loading initial artists', { country, tag })
		// NOTE: `tag` field requires BSR proto publish (specification#73).
		// Once ListTopRequest includes `tag`, add it to the request object.
		const resp = await this.artistClient.listTop({ country })
		const bubbles = resp.artists
			.map((a) => this.toBubble(a))
			.filter((b) => !this.seenArtistNames.has(b.name.toLowerCase()))
		this.availableBubbles = bubbles
		for (const b of this.availableBubbles) {
			this.seenArtistNames.add(b.name.toLowerCase())
		}
		this.logger.info('Loaded initial artists', {
			count: this.availableBubbles.length,
		})
	}

	public async reloadWithTag(tag: string, country = 'Japan'): Promise<void> {
		this.logger.info('Reloading artists with tag', { tag, country })
		this.seenArtistNames.clear()
		for (const f of this.followedArtists) {
			this.seenArtistNames.add(f.name.toLowerCase())
		}
		// NOTE: `tag` field requires BSR proto publish (specification#73).
		const resp = await this.artistClient.listTop({ country })
		const bubbles = resp.artists
			.map((a) => this.toBubble(a))
			.filter((b) => !this.seenArtistNames.has(b.name.toLowerCase()))
		this.availableBubbles = bubbles
		for (const b of this.availableBubbles) {
			this.seenArtistNames.add(b.name.toLowerCase())
		}
		this.logger.info('Reloaded artists with tag', {
			tag,
			count: this.availableBubbles.length,
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
		this.availableBubbles = this.availableBubbles.filter(
			(b) => b.id !== artist.id,
		)
		this.followedIds.add(artist.id)
		this.followedArtists.push(artist)
		this.orbIntensity = Math.min(1, this.followedArtists.length / 20)

		// Fire-and-forget: persist follow to backend without blocking UI
		this.artistClient
			.follow({ artistId: new ArtistId({ value: artist.id }) })
			.catch((err) => this.logger.error('Failed to follow artist via RPC', err))

		this.logger.info('Artist followed', {
			followed: this.followedArtists.length,
			orbIntensity: this.orbIntensity,
		})
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
			.filter(
				(a) => !this.seenArtistNames.has((a.name?.value ?? '').toLowerCase()),
			)
			.map((a) => this.toBubble(a))

		for (const b of newBubbles) {
			this.seenArtistNames.add(b.name.toLowerCase())
			this.availableBubbles.push(b)
		}

		return newBubbles
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
			const bubbles = resp.artists.map((a) => this.toBubble(a))
			this.logger.info('Followed artists fetched', { count: bubbles.length })
			return bubbles
		} catch (err) {
			this.logger.error('Failed to fetch followed artists', err)
			throw err
		}
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
