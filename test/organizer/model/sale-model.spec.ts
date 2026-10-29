import { SeatTypeSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import {
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketStockSchema,
	TicketStockState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import {
	LotteryEntryStatsSchema,
	ReferralCodeStatsSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	currentSale,
	referralRowsOf,
	saleViewsOf,
} from '../../../organizer/model/sale-model'
import { stockViewsOf } from '../../../organizer/model/stock-model'

const EVENT_SPEC = 'components/infrastructure/organizer/web/route/event'

function stats(
	code: string | undefined,
	orderCount: number,
	ticketCount: number,
	amount: number,
) {
	return create(ReferralCodeStatsSchema, {
		code: code ? { value: code } : undefined,
		orderCount,
		ticketCount,
		amount: BigInt(amount),
	})
}

describe('referralRowsOf', () => {
	it('keeps the server order of the codes and moves the direct group last', () => {
		const rows = referralRowsOf([
			stats(undefined, 40, 71, 461_500),
			stats('member-a', 12, 21, 136_500),
			stats('member-b', 5, 8, 52_000),
		])

		expect(rows.map((r) => r.cells.code)).toEqual([
			'member-a',
			'member-b',
			{ key: 'sale.referral.direct' },
		])
		expect(rows[0].cells).toEqual({
			code: 'member-a',
			orders: { key: 'sale.referral.orderCount', params: { count: 12 } },
			tickets: { key: 'sale.referral.ticketCount', params: { count: 21 } },
			amount: 136_500n,
		})
	})

	it('has no rows without a Paid Order', () => {
		expect(referralRowsOf([])).toEqual([])
	})
})

const jst = (at: string) => new Date(`${at}+09:00`)

function sale(init: {
	id: string
	method: TicketSaleMethod
	start: string
	end: string
	eventId?: string
}) {
	return create(TicketSaleSchema, {
		id: { value: init.id },
		name: { value: init.id },
		method: init.method,
		saleStartTime: timestampFromDate(jst(init.start)),
		saleEndTime: timestampFromDate(jst(init.end)),
		eventIds: [{ value: init.eventId ?? 'e-1' }],
	})
}

function entryStats(
	saleId: string,
	stockId: string,
	c: {
		entries: number
		tickets: number
		won?: number
		wonTickets?: number
		lost?: number
	},
) {
	return create(LotteryEntryStatsSchema, {
		ticketSaleId: { value: saleId },
		ticketStockId: { value: stockId },
		seatTypeId: { value: `seat-${stockId}` },
		entryCount: c.entries,
		ticketCount: c.tickets,
		wonEntryCount: c.won ?? 0,
		wonTicketCount: c.wonTickets ?? 0,
		lostEntryCount: c.lost ?? 0,
	})
}

/** S席 of 1,500 tickets with 300 sold: 1,200 remain. */
const S_STOCK = stockViewsOf({
	ticketStocks: [
		create(TicketStockSchema, {
			id: { value: 'st-s' },
			eventId: { value: 'e-1' },
			seatTypeId: { value: 'seat-s' },
			quantity: 1500,
			soldCount: 300,
			heldCount: 0,
			state: TicketStockState.AVAILABLE,
		}),
	],
	seatTypes: [
		create(SeatTypeSchema, {
			id: { value: 'seat-s' },
			name: { value: 'S席' },
			price: { value: BigInt(8000) },
		}),
	],
})

describe('saleViewsOf', () => {
	const now = jst('2026-10-08T09:00:00').getTime()
	const lottery = (id: string, start: string, end: string) =>
		sale({ id, method: TicketSaleMethod.LOTTERY, start, end })

	it(`@spec ${EVENT_SPEC} "Open lottery, oversubscribed"`, () => {
		const [view] = saleViewsOf(
			'e-1',
			{
				ticketSales: [
					lottery('fc', '2026-10-05T12:00:00', '2026-10-12T23:59:00'),
				],
				lotteryEntryStats: [
					entryStats('fc', 'st-s', { entries: 412, tickets: 1380 }),
				],
				referralCodeStats: [],
			},
			now,
			S_STOCK,
		)
		expect(view.state).toBe('open')
		expect(view.lottery?.stocks).toEqual([
			{
				id: 'st-s',
				name: 'S席',
				entries: 412,
				requested: 1380,
				remaining: 1200,
				oversubscribedPercent: 115,
			},
		])
	})

	it(`@spec ${EVENT_SPEC} "Drawn lottery"`, () => {
		const [view] = saleViewsOf(
			'e-1',
			{
				ticketSales: [
					lottery('fc', '2026-09-20T12:00:00', '2026-09-27T23:59:00'),
				],
				lotteryEntryStats: [
					entryStats('fc', 'st-s', {
						entries: 412,
						tickets: 1380,
						won: 318,
						wonTickets: 1198,
						lost: 94,
					}),
				],
				referralCodeStats: [],
			},
			now,
			S_STOCK,
		)
		expect(view.state).toBe('drawn')
		expect(view.stateKey).toBe('sale.lotteryState.drawn')
		expect(view.lottery).toMatchObject({ won: 318, wonTickets: 1198, lost: 94 })
	})

	it('waits for the draw while a closed lottery has an Entered entry', () => {
		const [view] = saleViewsOf(
			'e-1',
			{
				ticketSales: [
					lottery('fc', '2026-09-20T12:00:00', '2026-09-27T23:59:00'),
				],
				lotteryEntryStats: [
					entryStats('fc', 'st-s', {
						entries: 412,
						tickets: 1380,
						won: 318,
						lost: 93,
					}),
				],
				referralCodeStats: [],
			},
			now,
			S_STOCK,
		)
		expect(view.state).toBe('awaitingDraw')
	})

	it('lists only the sales naming the event, first-come sales by their window', () => {
		const views = saleViewsOf(
			'e-1',
			{
				ticketSales: [
					sale({
						id: 'general',
						method: TicketSaleMethod.FIRST_COME,
						start: '2026-10-01T10:00:00',
						end: '2026-11-03T17:00:00',
					}),
					sale({
						id: 'other',
						method: TicketSaleMethod.FIRST_COME,
						start: '2026-10-01T10:00:00',
						end: '2026-11-03T17:00:00',
						eventId: 'e-2',
					}),
				],
				lotteryEntryStats: [],
				referralCodeStats: [],
			},
			now,
		)
		expect(views.map((v) => [v.id, v.state, v.stateKey])).toEqual([
			['general', 'open', 'sale.firstComeState.open'],
		])
		expect(currentSale(views)?.id).toBe('general')
	})
})

describe('stockViewsOf', () => {
	it('reads each stock with its seat type, counts and state', () => {
		expect(S_STOCK).toEqual([
			{
				id: 'st-s',
				seatTypeId: 'seat-s',
				name: 'S席',
				price: 8000,
				quantity: 1500,
				sold: 300,
				held: 0,
				remaining: 1200,
				state: 'available',
				tone: 'success',
				stateKey: 'stock.state.available',
				deletable: false,
			},
		])
	})
})
