import {
	type TicketJourney,
	TicketJourneyStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js'
import { EventId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { TicketJourneyService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/ticket_journey/v1/ticket_journey_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { JourneyStatus } from '../entities/concert'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const ITicketJourneyService = DI.createInterface<ITicketJourneyService>(
	'ITicketJourneyService',
	(x) => x.singleton(TicketJourneyServiceClient),
)

export interface ITicketJourneyService extends TicketJourneyServiceClient {}

export class TicketJourneyServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('TicketJourneyService')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		TicketJourneyService,
		createTransport(this.authService, resolve(ILogger).scopeTo('Transport')),
	)

	public async listByUser(
		signal?: AbortSignal,
	): Promise<Map<string, JourneyStatus>> {
		this.logger.info('Listing ticket journeys for current user')
		try {
			const response = await this.client.listByUser({}, { signal })
			return toStatusMap(response.journeys)
		} catch (err) {
			this.logger.warn('ListByUser failed', { error: err })
			throw err
		}
	}

	public async setStatus(
		eventId: string,
		status: JourneyStatus,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Setting ticket journey status', { eventId, status })
		try {
			await this.client.setStatus(
				{
					eventId: new EventId({ value: eventId }),
					status: journeyStatusToProto[status],
				},
				{ signal },
			)
		} catch (err) {
			this.logger.warn('SetStatus failed', { eventId, error: err })
			throw err
		}
	}

	public async delete(eventId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Deleting ticket journey', { eventId })
		try {
			await this.client.delete(
				{ eventId: new EventId({ value: eventId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('Delete failed', { eventId, error: err })
			throw err
		}
	}
}

const protoToJourneyStatus: Record<number, JourneyStatus> = {
	[TicketJourneyStatus.TRACKING]: 'tracking',
	[TicketJourneyStatus.APPLIED]: 'applied',
	[TicketJourneyStatus.LOST]: 'lost',
	[TicketJourneyStatus.UNPAID]: 'unpaid',
	[TicketJourneyStatus.PAID]: 'paid',
}

const journeyStatusToProto: Record<JourneyStatus, TicketJourneyStatus> = {
	tracking: TicketJourneyStatus.TRACKING,
	applied: TicketJourneyStatus.APPLIED,
	lost: TicketJourneyStatus.LOST,
	unpaid: TicketJourneyStatus.UNPAID,
	paid: TicketJourneyStatus.PAID,
}

function toStatusMap(journeys: TicketJourney[]): Map<string, JourneyStatus> {
	const map = new Map<string, JourneyStatus>()
	for (const j of journeys) {
		const eventId = j.eventId?.value
		const status = protoToJourneyStatus[j.status]
		if (eventId && status) {
			map.set(eventId, status)
		}
	}
	return map
}
