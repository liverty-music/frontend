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

	@observable public artistsWithConcerts = new Set<string>()

	public get artistsWithConcertsCount(): number {
		return this.artistsWithConcerts.size
	}

	/**
	 * Search for new concerts for an artist. Blocks until the backend
	 * Gemini search completes (up to 60s) and returns discovered concerts.
	 */
	public async searchNewConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ProtoConcert[]> {
		return this.rpcClient.searchNewConcerts(artistId, signal)
	}

	/**
	 * Add an artist to the set of artists with known concerts.
	 * Triggers Aurelia observation for the coach mark getter.
	 */
	public addArtistWithConcerts(artistId: string): void {
		this.artistsWithConcerts = new Set([...this.artistsWithConcerts, artistId])
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
}
