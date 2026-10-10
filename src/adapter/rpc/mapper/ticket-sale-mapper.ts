import {
	type TicketSale as ProtoTicketSale,
	TicketSaleState as ProtoTicketSaleState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { TicketSale, TicketSaleState } from '../../../entities/ticket-sale'

const STATES: Record<number, TicketSaleState> = {
	[ProtoTicketSaleState.NOT_YET_ON_SALE]: 'notYetOnSale',
	[ProtoTicketSaleState.ON_SALE]: 'onSale',
	[ProtoTicketSaleState.ALL_HELD]: 'allHeld',
	[ProtoTicketSaleState.SOLD_OUT]: 'soldOut',
	[ProtoTicketSaleState.ENDED]: 'ended',
}

export function ticketSaleFrom(proto: ProtoTicketSale): TicketSale {
	return {
		id: proto.id?.value ?? '',
		eventId: proto.eventId?.value ?? '',
		saleStart: proto.saleStartTime
			? timestampDate(proto.saleStartTime)
			: new Date(0),
		saleEnd: proto.saleEndTime ? timestampDate(proto.saleEndTime) : new Date(0),
		price: Number(proto.price),
		perAccountLimit: proto.perAccountLimit,
		// An unknown state is treated as ended: the sale is shown but not sold.
		state: STATES[proto.state] ?? 'ended',
		lowStock: proto.lowStock,
	}
}
