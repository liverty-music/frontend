import {
	LotteryEntrySchema,
	LotteryEntryState as ProtoLotteryEntryState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_entry_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { lotteryEntryFrom, lotteryEntryStateFrom } from './lottery-entry-mapper'

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

	it('maps the id, ticket type, count and state', () => {
		const proto = create(LotteryEntrySchema, {
			id: { value: 'entry-1' },
			ticketTypeId: { value: 'type-1' },
			ticketCount: 2,
			state: ProtoLotteryEntryState.ENTERED,
		})

		expect(lotteryEntryFrom(proto)).toEqual({
			id: 'entry-1',
			ticketTypeId: 'type-1',
			ticketCount: 2,
			state: 'entered',
		})
	})
})
