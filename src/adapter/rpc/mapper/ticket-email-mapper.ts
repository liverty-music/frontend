import {
	type TicketEmail as ProtoTicketEmail,
	TicketEmailType as ProtoTicketEmailType,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_email_pb.js'
import type {
	TicketEmail,
	TicketEmailType,
} from '../../../entities/ticket-email'
import { journeyStatusFrom } from './ticket-journey-mapper'

const protoToEmailType: Record<number, TicketEmailType> = {
	[ProtoTicketEmailType.LOTTERY_INFO]: 'lottery_info',
	[ProtoTicketEmailType.LOTTERY_RESULT]: 'lottery_result',
}

const emailTypeToProto: Record<TicketEmailType, ProtoTicketEmailType> = {
	lottery_info: ProtoTicketEmailType.LOTTERY_INFO,
	lottery_result: ProtoTicketEmailType.LOTTERY_RESULT,
}

/** Map a domain email type to its proto enum value for request construction. */
export function emailTypeTo(type: TicketEmailType): ProtoTicketEmailType {
	return emailTypeToProto[type]
}

/**
 * Map a proto `TicketEmail` to the domain entity: id/event references collapse to
 * strings, optional timestamps to native `Date`s, and the journey status to the
 * shared domain union. An unmapped `email_type` (e.g. UNSPECIFIED) falls back to
 * `lottery_info`, matching the wizard's default detection.
 */
export function ticketEmailFrom(proto: ProtoTicketEmail): TicketEmail {
	return {
		id: proto.id?.value ?? '',
		eventId: proto.eventId?.value ?? '',
		emailType: protoToEmailType[proto.emailType] ?? 'lottery_info',
		rawBody: proto.rawBody,
		applicationUrl: proto.applicationUrl,
		lotteryStart: proto.lotteryStart?.toDate(),
		lotteryEnd: proto.lotteryEnd?.toDate(),
		paymentDeadline: proto.paymentDeadline?.toDate(),
		journeyStatus:
			proto.journeyStatus !== undefined
				? journeyStatusFrom(proto.journeyStatus)
				: undefined,
	}
}
