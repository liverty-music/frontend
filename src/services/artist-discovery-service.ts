import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { transport } from './grpc-transport'

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

const artistClient = createPromiseClient(ArtistService, transport)

export class ArtistDiscoveryService {
	private readonly logger = resolve(ILogger).scopeTo('ArtistDiscoveryService')

	public availableBubbles: ArtistBubble[] = []
	public followedArtists: ArtistBubble[] = []
	public orbIntensity = 0

	private readonly seenArtistNames = new Set<string>()

	public async loadInitialArtists(country = 'Japan'): Promise<void> {
		this.logger.info('Loading initial artists', { country })
		const resp = await artistClient.listTop({ country })
		const bubbles = resp.artists.map((a) => this.toBubble(a))
		this.availableBubbles = bubbles
		for (const b of this.availableBubbles) {
			this.seenArtistNames.add(b.name.toLowerCase())
		}
		this.logger.info('Loaded initial artists', {
			count: this.availableBubbles.length,
		})
	}

	public async followArtist(artist: ArtistBubble): Promise<void> {
		this.logger.info('Following artist', { artist: artist.name })
		this.availableBubbles = this.availableBubbles.filter(
			(b) => b.id !== artist.id,
		)
		this.followedArtists.push(artist)
		this.orbIntensity = Math.min(1, this.followedArtists.length / 20)

		// TODO: Call backend ArtistService.Follow via Connect-RPC when TS clients are generated
		// await artistClient.follow({ artistId: new ArtistId({ value: artist.id }) })

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

		const resp = await artistClient.listSimilar({
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

	public async listFollowedFromBackend(): Promise<ArtistBubble[]> {
		this.logger.info('Fetching followed artists from backend')
		try {
			const resp = await artistClient.listFollowed({})
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
