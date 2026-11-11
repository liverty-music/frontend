import { SeatTypeSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import {
	TicketSaleMethod,
	TicketSaleSchema,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketStockSchema,
	TicketStockState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import { ListByEventResponseSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket_sale/v1/ticket_sale_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	eventTicketSalesFrom,
	ticketSaleFrom,
	ticketStockFrom,
} from '../../../../src/adapter/rpc/mapper/ticket-sale-mapper'

const seatType = create(SeatTypeSchema, {
	id: { value: 'seat-s' },
	name: { value: 'S席' },
	price: { value: 5000n },
})

describe('ticketStockFrom', () => {
	it('maps each stock state and joins the seat type by id', () => {
		const states: [TicketStockState, string][] = [
			[TicketStockState.AVAILABLE, 'available'],
			[TicketStockState.ALL_HELD, 'allHeld'],
			[TicketStockState.SOLD_OUT, 'soldOut'],
		]
		for (const [proto, expected] of states) {
			const stock = ticketStockFrom(
				create(TicketStockSchema, {
					id: { value: 'stock-1' },
					eventId: { value: 'event-1' },
					seatTypeId: { value: 'seat-s' },
					state: proto,
					lowStock: true,
					resaleOpen: true,
				}),
				new Map([['seat-s', seatType]]),
			)
			expect(stock).toMatchObject({
				id: 'stock-1',
				eventId: 'event-1',
				seatTypeId: 'seat-s',
				seatTypeName: 'S席',
				price: 5000,
				state: expected,
				lowStock: true,
				resaleOpen: true,
			})
		}
	})

	it('falls back to empty values and an unknown state when ids or the seat type are missing', () => {
		const stock = ticketStockFrom(
			create(TicketStockSchema, { state: TicketStockState.UNSPECIFIED }),
			new Map(),
		)
		expect(stock).toMatchObject({
			id: '',
			eventId: '',
			seatTypeId: '',
			seatTypeName: '',
			price: 0,
			state: 'unknown',
		})
	})
})

describe('ticketSaleFrom', () => {
	it('maps a lottery sale with its window and requirement', () => {
		const start = new Date('2026-11-01T00:00:00Z')
		const end = new Date('2026-11-05T00:00:00Z')
		const sale = ticketSaleFrom(
			create(TicketSaleSchema, {
				id: { value: 'sale-1' },
				name: { value: '一次' },
				method: TicketSaleMethod.LOTTERY,
				saleStartTime: timestampFromDate(start),
				saleEndTime: timestampFromDate(end),
				verificationRequirement: VerificationRequirement.JPKI_ONLY,
				eventIds: [{ value: 'event-1' }],
			}),
		)
		expect(sale).toEqual({
			id: 'sale-1',
			name: '一次',
			method: 'lottery',
			saleStartTime: start,
			saleEndTime: end,
			verificationRequirement: 'jpkiOnly',
			eventIds: ['event-1'],
		})
	})

	it('maps a first-come sale with no window or requirement to defaults', () => {
		const sale = ticketSaleFrom(
			create(TicketSaleSchema, {
				method: TicketSaleMethod.FIRST_COME,
				verificationRequirement: VerificationRequirement.VERIFIED_ANY,
			}),
		)
		expect(sale).toMatchObject({
			id: '',
			name: '',
			method: 'firstCome',
			saleStartTime: new Date(0),
			saleEndTime: new Date(0),
			verificationRequirement: 'verifiedAny',
		})
		expect(
			ticketSaleFrom(
				create(TicketSaleSchema, {
					verificationRequirement: VerificationRequirement.UNSPECIFIED,
				}),
			).verificationRequirement,
		).toBe('none')
	})
})

describe('eventTicketSalesFrom', () => {
	it('keeps only the stocks of the event and maps the limit', () => {
		const resp = create(ListByEventResponseSchema, {
			seatTypes: [seatType, create(SeatTypeSchema, {})],
			ticketStocks: [
				create(TicketStockSchema, {
					id: { value: 'a' },
					eventId: { value: 'event-1' },
					seatTypeId: { value: 'seat-s' },
				}),
				create(TicketStockSchema, {
					id: { value: 'b' },
					eventId: { value: 'event-2' },
				}),
			],
			perAccountLimit: 4,
		})
		const mapped = eventTicketSalesFrom(resp, 'event-1')
		expect(mapped.stocks.map((s) => s.id)).toEqual(['a'])
		expect(mapped.stocks[0].seatTypeName).toBe('S席')
		expect(mapped.perAccountLimit).toBe(4)
		expect(
			eventTicketSalesFrom(create(ListByEventResponseSchema, {}), 'event-1')
				.perAccountLimit,
		).toBeNull()
	})
})
