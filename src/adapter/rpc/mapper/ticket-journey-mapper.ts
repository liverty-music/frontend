import { TicketJourneyStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js'
import type { JourneyStatus } from '../../../entities/concert'

const protoToEntity: Record<number, JourneyStatus> = {
	[TicketJourneyStatus.TRACKING]: 'tracking',
	[TicketJourneyStatus.APPLIED]: 'applied',
	[TicketJourneyStatus.LOST]: 'lost',
	[TicketJourneyStatus.UNPAID]: 'unpaid',
	[TicketJourneyStatus.PAID]: 'paid',
}

const entityToProto: Record<JourneyStatus, TicketJourneyStatus> = {
	tracking: TicketJourneyStatus.TRACKING,
	applied: TicketJourneyStatus.APPLIED,
	lost: TicketJourneyStatus.LOST,
	unpaid: TicketJourneyStatus.UNPAID,
	paid: TicketJourneyStatus.PAID,
}

export function journeyStatusFrom(
	proto: TicketJourneyStatus,
): JourneyStatus | undefined {
	return protoToEntity[proto]
}

export function journeyStatusTo(status: JourneyStatus): TicketJourneyStatus {
	return entityToProto[status]
}
