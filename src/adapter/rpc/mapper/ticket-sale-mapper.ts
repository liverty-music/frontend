import {
	type TicketSale as ProtoTicketSale,
	TicketSaleMethod as ProtoTicketSaleMethod,
	VerificationRequirement as ProtoVerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	type TicketType as ProtoTicketType,
	TicketTypeState as ProtoTicketTypeState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	TicketSale,
	TicketType,
	TicketTypeState,
	VerificationRequirement,
} from '../../../entities/ticket-sale'

const STATES: Record<number, TicketTypeState> = {
	[ProtoTicketTypeState.NOT_YET_ON_SALE]: 'notYetOnSale',
	[ProtoTicketTypeState.ON_SALE]: 'onSale',
	[ProtoTicketTypeState.ALL_HELD]: 'allHeld',
	[ProtoTicketTypeState.SOLD_OUT]: 'soldOut',
	[ProtoTicketTypeState.ENDED]: 'ended',
}

const REQUIREMENTS: Record<number, VerificationRequirement> = {
	[ProtoVerificationRequirement.VERIFIED_ANY]: 'verifiedAny',
	[ProtoVerificationRequirement.JPKI_ONLY]: 'jpkiOnly',
}

export function ticketTypeFrom(proto: ProtoTicketType): TicketType {
	return {
		id: proto.id?.value ?? '',
		eventId: proto.eventId?.value ?? '',
		price: Number(proto.price?.value ?? 0),
		perAccountLimit: proto.perAccountLimit,
		// An unknown state is treated as ended: the TicketType is shown but not
		// sold.
		state: STATES[proto.state] ?? 'ended',
		lowStock: proto.lowStock,
	}
}

/**
 * Map a sale read for `eventId` to the domain entity with its TicketType for
 * that event, or null when the sale offers none for it.
 */
export function ticketSaleFrom(
	proto: ProtoTicketSale,
	eventId: string,
): TicketSale | null {
	const type = proto.ticketTypes.find((t) => t.eventId?.value === eventId)
	if (!type) return null
	return {
		id: proto.id?.value ?? '',
		name: proto.name?.value ?? '',
		method:
			proto.method === ProtoTicketSaleMethod.LOTTERY ? 'lottery' : 'firstCome',
		saleStart: proto.saleStartTime
			? timestampDate(proto.saleStartTime)
			: new Date(0),
		saleEnd: proto.saleEndTime ? timestampDate(proto.saleEndTime) : new Date(0),
		verificationRequirement:
			REQUIREMENTS[proto.verificationRequirement] ?? 'none',
		ticketType: ticketTypeFrom(type),
	}
}
