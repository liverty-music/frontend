import type { SeatType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import { SeatTypeService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/seat_type/v1/seat_type_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export type { SeatType }

/** The plain input of a new seat type: its name and whole-yen 税込 price. */
export interface CreateSeatTypeInput {
	readonly seriesId: string
	readonly name: string
	readonly price: number
}

export const ISeatTypeClient = DI.createInterface<ISeatTypeClient>(
	'ISeatTypeClient',
	(x) => x.singleton(SeatTypeClient),
)

export interface ISeatTypeClient extends SeatTypeClient {}

/**
 * Organizer-local wrapper around the generated organizer `SeatTypeService`
 * client: the seat types (席種) of one of the caller's Series, each a name and
 * a price that never change. Errors propagate to callers, which choose the
 * catalog copy from the `ConnectError` code (AlreadyExists for a name already
 * used, FailedPrecondition for a seat type a TicketStock uses).
 */
export class SeatTypeClient {
	private readonly logger = resolve(ILogger).scopeTo('SeatTypeClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		SeatTypeService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	/** The Series' seat types, as the server orders them. */
	public async listBySeries(
		seriesId: string,
		signal?: AbortSignal,
	): Promise<SeatType[]> {
		this.logger.info('Listing seat types', { seriesId })
		try {
			const response = await this.client.listBySeries(
				{ seriesId: { value: seriesId } },
				{ signal },
			)
			return response.seatTypes
		} catch (err) {
			this.logger.warn('listBySeries failed', { seriesId, error: err })
			throw err
		}
	}

	/** Adds a seat type to the Series and returns it. */
	public async create(
		input: CreateSeatTypeInput,
		signal?: AbortSignal,
	): Promise<SeatType | undefined> {
		this.logger.info('Creating seat type', { seriesId: input.seriesId })
		try {
			const response = await this.client.create(
				{
					seriesId: { value: input.seriesId },
					name: { value: input.name },
					// Whole yen; the wire field is int64 → bigint.
					price: { value: BigInt(input.price) },
				},
				{ signal },
			)
			return response.seatType
		} catch (err) {
			this.logger.warn('create failed', {
				seriesId: input.seriesId,
				error: err,
			})
			throw err
		}
	}

	/** Deletes a seat type no TicketStock uses. */
	public async delete(seatTypeId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Deleting seat type', { seatTypeId })
		try {
			await this.client.delete(
				{ seatTypeId: { value: seatTypeId } },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('delete failed', { seatTypeId, error: err })
			throw err
		}
	}
}
