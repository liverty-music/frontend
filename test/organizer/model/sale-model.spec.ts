import { ReferralCodeStatsSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { referralRowsOf } from '../../../organizer/model/sale-model'

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
