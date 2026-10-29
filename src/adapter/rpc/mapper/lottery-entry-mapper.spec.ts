import {
	LotteryEntrySchema,
	LotteryEntryState as ProtoLotteryEntryState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_entry_pb.js'
import { OrderSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
	lotteryEntriesFrom,
	lotteryEntryStateFrom,
} from './lottery-entry-mapper'

describe('lottery-entry-mapper', () => {
	it('maps every proto state to its domain union value', () => {
		expect(lotteryEntryStateFrom(ProtoLotteryEntryState.ENTERED)).toBe(
			'entered',
		)
		expect(lotteryEntryStateFrom(ProtoLotteryEntryState.WON)).toBe('won')
		expect(lotteryEntryStateFrom(ProtoLotteryEntryState.LOST)).toBe('lost')
		expect(lotteryEntryStateFrom(ProtoLotteryEntryState.UNSPECIFIED)).toBe(
			'unknown',
		)
	})

	it('maps the id, sale and state, with the stock and count of its Order', () => {
		const entry = create(LotteryEntrySchema, {
			id: { value: 'entry-1' },
			orderId: { value: 'order-1' },
			ticketSaleId: { value: 'sale-1' },
			state: ProtoLotteryEntryState.ENTERED,
		})
		const order = create(OrderSchema, {
			id: { value: 'order-1' },
			ticketStockId: { value: 'stock-1' },
			ticketCount: 2,
		})

		expect(lotteryEntriesFrom([entry], [order])).toEqual([
			{
				id: 'entry-1',
				orderId: 'order-1',
				ticketSaleId: 'sale-1',
				ticketStockId: 'stock-1',
				ticketCount: 2,
				state: 'entered',
			},
		])
	})
})
