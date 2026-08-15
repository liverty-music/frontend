import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { LocalDate } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import { GeoLocation } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/geo_location_pb.js'
import { Home } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import type { ProximityGroup } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { GeoLocationInit } from '../../../entities/user'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export type { ProtoConcert, ProximityGroup }

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

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ProtoConcert[]> {
		this.logger.info('Listing concerts', { artistId })
		try {
			const response = await this.client.list(
				{
					artistId: new ArtistId({ value: artistId }),
				},
				{ signal },
			)
			return response.concerts
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
				from ? { from: new LocalDate({ value: from }) } : {},
				{ signal },
			)
			return response.groups
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
				artistIds: artistIds.map((id) => new ArtistId({ value: id })),
				home: new Home({ countryCode, level1 }),
			},
			{ signal },
		)
		return response.groups
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
					location: new GeoLocation(location),
					from: new LocalDate({ value: from }),
					to: new LocalDate({ value: to }),
				},
				{ signal },
			)
			return response.groups
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
