import type { Ticket as ProtoTicket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import type { Ticket } from '../../../entities/ticket'

export function ticketFrom(proto: ProtoTicket): Ticket {
	const mintTime = proto.mintTime
	return {
		id: proto.id?.value ?? '',
		eventId: proto.eventId?.value ?? '',
		userId: proto.userId?.value ?? '',
		tokenId: proto.tokenId?.value?.toString(),
		mintTime: mintTime
			? new Date(Number(mintTime.seconds) * 1000 + mintTime.nanos / 1_000_000)
			: undefined,
	}
}
