import type { SeatType as ProtoSeatType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import {
	type TicketSale as ProtoTicketSale,
	TicketSaleMethod as ProtoTicketSaleMethod,
	VerificationRequirement as ProtoVerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	type TicketStock as ProtoTicketStock,
	TicketStockState as ProtoTicketStockState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import type { ListByEventResponse } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket_sale/v1/ticket_sale_service_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	EventTicketSales,
	TicketSale,
	TicketStock,
	TicketStockState,
	VerificationRequirement,
} from '../../../entities/ticket-sale'

const STATES: Record<number, TicketStockState> = {
	[ProtoTicketStockState.AVAILABLE]: 'available',
	[ProtoTicketStockState.ALL_HELD]: 'allHeld',
	[ProtoTicketStockState.SOLD_OUT]: 'soldOut',
}

const REQUIREMENTS: Record<number, VerificationRequirement> = {
	[ProtoVerificationRequirement.VERIFIED_ANY]: 'verifiedAny',
	[ProtoVerificationRequirement.JPKI_ONLY]: 'jpkiOnly',
}

/** Map a stock with its seat type; the seat type is looked up by id. */
export function ticketStockFrom(
	proto: ProtoTicketStock,
	seatTypes: ReadonlyMap<string, ProtoSeatType>,
): TicketStock {
	const seatTypeId = proto.seatTypeId?.value ?? ''
	const seatType = seatTypes.get(seatTypeId)
	return {
		id: proto.id?.value ?? '',
		eventId: proto.eventId?.value ?? '',
		seatTypeId,
		seatTypeName: seatType?.name?.value ?? '',
		price: Number(seatType?.price?.value ?? 0),
		state: STATES[proto.state] ?? 'unknown',
		lowStock: proto.lowStock,
		resaleOpen: proto.resaleOpen,
	}
}

export function ticketSaleFrom(proto: ProtoTicketSale): TicketSale {
	return {
		id: proto.id?.value ?? '',
		name: proto.name?.value ?? '',
		method:
			proto.method === ProtoTicketSaleMethod.LOTTERY ? 'lottery' : 'firstCome',
		saleStartTime: proto.saleStartTime
			? timestampDate(proto.saleStartTime)
			: new Date(0),
		saleEndTime: proto.saleEndTime
			? timestampDate(proto.saleEndTime)
			: new Date(0),
		verificationRequirement:
			REQUIREMENTS[proto.verificationRequirement] ?? 'none',
		eventIds: proto.eventIds.map((e) => e.value),
	}
}

/**
 * Map ListByEvent's response for `eventId`: its sales, and the stocks of that
 * event with their seat types. A stock of another event is dropped.
 */
export function eventTicketSalesFrom(
	resp: ListByEventResponse,
	eventId: string,
): EventTicketSales {
	const seatTypes = new Map(
		resp.seatTypes.flatMap((t) => (t.id ? [[t.id.value, t] as const] : [])),
	)
	return {
		sales: resp.ticketSales.map(ticketSaleFrom),
		stocks: resp.ticketStocks
			.filter((s) => s.eventId?.value === eventId)
			.map((s) => ticketStockFrom(s, seatTypes)),
		perAccountLimit: resp.perAccountLimit ?? null,
	}
}
