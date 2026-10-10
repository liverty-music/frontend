import type { Artist as ProtoArtist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { LocalDate } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import type { Series as ProtoSeries } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	ConcertService,
	type ProximityGroup as ProtoProximityGroup,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import {
	concertResolver,
	type ResolvedConcert,
	resolveConcerts,
} from '../../../../shared/lib/concert/resolve-concert'
import { IAppConfig } from '../../../config/app-config'
import type { GeoLocationInit } from '../../../entities/user'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export type { ResolvedConcert }
export { concertResolver, resolveConcerts }

/** A date's concerts, by proximity lane, with each Concert resolved. */
export interface ProximityGroup {
	readonly date?: LocalDate
	readonly home: ResolvedConcert[]
	readonly nearby: ResolvedConcert[]
	readonly away: ResolvedConcert[]
}

/** Resolve a grouped response's Concerts against its `series` and `artists`. */
export function resolveGroups(response: {
	groups: readonly ProtoProximityGroup[]
	series: readonly ProtoSeries[]
	artists: readonly ProtoArtist[]
}): ProximityGroup[] {
	const resolve = concertResolver(response.series, response.artists)
	const lane = (concerts: readonly ProtoConcert[]) =>
		concerts.flatMap((c) => {
			const r = resolve(c)
			return r ? [r] : []
		})
	return response.groups.map((g) => ({
		date: g.date,
		home: lane(g.home),
		nearby: lane(g.nearby),
		away: lane(g.away),
	}))
}

export const IConcertRpcClient = DI.createInterface<IConcertRpcClient>(
	'IConcertRpcClient',
	(x) => x.singleton(ConcertRpcClient),
)

export interface IConcertRpcClient extends ConcertRpcClient {}

export class ConcertRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertRpcClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ConcertService,
		createTransport(
			this.authService,
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * The concert of one event for its public event page. Rejects with a
	 * ConnectError of Code.NotFound when the event has no page (unknown id,
	 * discovered, draft or unlisted series), the same for every reason.
	 */
	public async get(
		eventId: string,
		signal?: AbortSignal,
	): Promise<ResolvedConcert> {
		this.logger.info('Getting concert', { eventId })
		try {
			const response = await this.client.get(
				{ eventId: { value: eventId } },
				{ signal },
			)
			const concert = response.concert
				? concertResolver(response.series, response.artists)(response.concert)
				: null
			if (!concert) {
				throw new Error('ConcertService.Get returned no concert')
			}
			return concert
		} catch (err) {
			this.logger.warn('Concert get failed', { eventId, error: err })
			throw err
		}
	}

	/**
	 * The concerts of one series that has an event page, ordered by date and
	 * start time. Rejects with Code.NotFound like {@link get}.
	 */
	public async listBySeries(
		seriesId: string,
		signal?: AbortSignal,
	): Promise<ResolvedConcert[]> {
		this.logger.info('Listing concerts by series', { seriesId })
		try {
			const response = await this.client.listBySeries(
				{ seriesId: { value: seriesId } },
				{ signal },
			)
			return resolveConcerts(response)
		} catch (err) {
			this.logger.warn('Concert listBySeries failed', { seriesId, error: err })
			throw err
		}
	}

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ResolvedConcert[]> {
		this.logger.info('Listing concerts', { artistId })
		try {
			const response = await this.client.list(
				{
					artistId: { value: artistId },
				},
				{ signal },
			)
			return resolveConcerts(response)
		} catch (err) {
			this.logger.warn('Concert list failed', { artistId, error: err })
			throw err
		}
	}

	/**
	 * The follower-scoped concert list. When `from` is provided the server returns
	 * concerts on or after that date (including past dates); when omitted the
	 * server defaults to today onward. The dashboard always passes the client's
	 * local date so the "today" boundary is anchored to the caller's timezone.
	 */
	public async listByFollower(
		from?: CalendarDate,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		this.logger.info('Listing concerts by follower', { from })
		try {
			// Wrap the optional client date in LocalDate (mirrors listByLocation).
			// Omitting from lets the server apply its today-onward default.
			const response = await this.client.listByFollower(
				from ? { from: { value: from } } : {},
				{ signal },
			)
			return resolveGroups(response)
		} catch (err) {
			this.logger.warn('Concert listByFollower failed', { error: err })
			throw err
		}
	}

	public async listByArtists(
		artistIds: string[],
		countryCode: string,
		level1: string,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const response = await this.client.listByArtists(
			{
				artistIds: artistIds.map((id) => ({ value: id })),
				home: { countryCode, level1 },
			},
			{ signal },
		)
		return resolveGroups(response)
	}

	public async listByLocation(
		location: GeoLocationInit,
		from: CalendarDate,
		to: CalendarDate,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		this.logger.info('Listing concerts by location', {
			adminArea: location.adminArea,
		})
		try {
			const response = await this.client.listByLocation(
				{
					location: location,
					from: { value: from },
					to: { value: to },
				},
				{ signal },
			)
			return resolveGroups(response)
		} catch (err) {
			this.logger.warn('Concert listByLocation failed', {
				adminArea: location.adminArea,
				error: err,
			})
			throw err
		}
	}
}

/**
 * A calendar date as year / 1-based month / day, matching the shape of
 * `google.type.Date` (the value carried by `entity.v1.LocalDate`). Callers build
 * these from the date-preset selector; the RPC client wraps them in `LocalDate`.
 */
export interface CalendarDate {
	year: number
	month: number
	day: number
}
