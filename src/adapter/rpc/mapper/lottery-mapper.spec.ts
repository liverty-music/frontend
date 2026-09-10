import {
	TicketApplicationState as ProtoTicketApplicationState,
	TicketApplicationSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
	ticketApplicationFrom,
	ticketApplicationStateFrom,
} from './lottery-mapper'

describe('lottery-mapper', () => {
	describe('ticketApplicationStateFrom', () => {
		it('maps every proto state to its domain union value', () => {
			expect(
				ticketApplicationStateFrom(ProtoTicketApplicationState.UNSPECIFIED),
			).toBe('unspecified')
			expect(
				ticketApplicationStateFrom(ProtoTicketApplicationState.APPLIED),
			).toBe('applied')
			expect(ticketApplicationStateFrom(ProtoTicketApplicationState.WON)).toBe(
				'won',
			)
			expect(ticketApplicationStateFrom(ProtoTicketApplicationState.LOST)).toBe(
				'lost',
			)
			expect(
				ticketApplicationStateFrom(ProtoTicketApplicationState.WITHDRAWN),
			).toBe('withdrawn')
		})
	})

	describe('ticketApplicationFrom', () => {
		it('maps count, 本人確認, and state to the domain entity', () => {
			const proto = create(TicketApplicationSchema, {
				requestedTicketCount: 2,
				identity: {
					fullName: '山田太郎',
					phoneNumber: '09012345678',
				},
				state: ProtoTicketApplicationState.APPLIED,
			})

			expect(ticketApplicationFrom(proto)).toEqual({
				requestedTicketCount: 2,
				identity: { fullName: '山田太郎', phoneNumber: '09012345678' },
				state: 'applied',
			})
		})

		it('defaults identity fields to empty strings when identity is unset', () => {
			const proto = create(TicketApplicationSchema, {
				requestedTicketCount: 1,
				state: ProtoTicketApplicationState.WON,
			})

			expect(ticketApplicationFrom(proto)).toEqual({
				requestedTicketCount: 1,
				identity: { fullName: '', phoneNumber: '' },
				state: 'won',
			})
		})
	})
})
