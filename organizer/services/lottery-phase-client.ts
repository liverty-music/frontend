import { EventId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import type { LotterySalesPhase } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { LotterySalesPhaseId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import type { GetLotteryPhaseStatusResponse } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/v1/lottery_service_pb.js'
import { LotteryService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/organizer/v1/lottery_service_connect.js'
import { Timestamp } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export type { GetLotteryPhaseStatusResponse, LotterySalesPhase }

/**
 * The plain, transport-agnostic configuration for a new lottery phase. `eventId`
 * targets the caller's own PUBLISHED event; the window `openTime` / `closeTime`
 * are absolute instants (the console composes them from wall-clock inputs).
 * `ticketPrice` is whole-yen JPY (bigint on the wire); capacity and per-order
 * max are positive integers. Marshalling into the generated request shell is
 * owned here so screens pass only this plain shape.
 */
export interface ConfigureLotteryPhaseInput {
	readonly eventId: string
	readonly openTime: Date
	readonly closeTime: Date
	readonly ticketCapacity: number
	readonly maxTicketsPerApplication: number
	readonly ticketPrice: number
}

export const ILotteryPhaseClient = DI.createInterface<ILotteryPhaseClient>(
	'ILotteryPhaseClient',
	(x) => x.singleton(LotteryPhaseClient),
)

export interface ILotteryPhaseClient extends LotteryPhaseClient {}

/**
 * Organizer-local wrapper around the generated organizer `LotteryService`
 * client: {@link configureLotteryPhase} attaches a lottery sales phase to one of
 * the caller's PUBLISHED events, and {@link getLotteryPhaseStatus} reads a
 * phase's live status plus its draw-outcome tallies. The caller's Organizer is
 * resolved from the token, so no request carries an organizer id; a phase is
 * addressed by its {@link LotterySalesPhaseId}.
 *
 * Built from organizer/shared modules via {@link createOrganizerTransport}; it
 * never imports the consumer `src/` nor the sibling `admin/` bundle. Callers
 * pass plain inputs; this wrapper owns marshalling them into the generated
 * message shells. Errors propagate to callers (screens translate `ConnectError`
 * codes via {@link ./connect-error-copy}).
 */
export class LotteryPhaseClient {
	private readonly logger = resolve(ILogger).scopeTo('LotteryPhaseClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		LotteryService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Attaches a new lottery sales phase to one of the caller's PUBLISHED events
	 * and returns the created phase (with its server-minted id).
	 */
	public async configureLotteryPhase(
		input: ConfigureLotteryPhaseInput,
		signal?: AbortSignal,
	): Promise<LotterySalesPhase | undefined> {
		this.logger.info('Configuring lottery phase', { eventId: input.eventId })
		try {
			const response = await this.client.configureLotteryPhase(
				{
					eventId: new EventId({ value: input.eventId }),
					openTime: Timestamp.fromDate(input.openTime),
					closeTime: Timestamp.fromDate(input.closeTime),
					ticketCapacity: input.ticketCapacity,
					maxTicketsPerApplication: input.maxTicketsPerApplication,
					// JPY whole-yen; the wire field is int64 → bigint.
					ticketPrice: BigInt(input.ticketPrice),
				},
				{ signal },
			)
			return response.phase
		} catch (err) {
			this.logger.warn('configureLotteryPhase failed', {
				eventId: input.eventId,
				error: err,
			})
			throw err
		}
	}

	/**
	 * Reads a phase's live status: its parameters, whether the window is open or
	 * closed, whether the draw has run, and the outcome tallies. The phase's event
	 * must be owned by the caller's Organizer (else PERMISSION_DENIED).
	 */
	public async getLotteryPhaseStatus(
		phaseId: string,
		signal?: AbortSignal,
	): Promise<GetLotteryPhaseStatusResponse> {
		this.logger.info('Getting lottery phase status', { phaseId })
		try {
			return await this.client.getLotteryPhaseStatus(
				{ phaseId: new LotterySalesPhaseId({ value: phaseId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('getLotteryPhaseStatus failed', { phaseId, error: err })
			throw err
		}
	}
}
