import {
	TicketEmailType as ProtoTicketEmailType,
	TicketEmailSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_email_pb.js'
import { TicketJourneyStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_journey_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import { emailTypeTo, ticketEmailFrom } from './ticket-email-mapper'

describe('ticket-email-mapper', () => {
	describe('ticketEmailFrom', () => {
		it('maps a fully populated LOTTERY_INFO proto to the domain entity', () => {
			const start = new Date('2026-01-10T09:00:00Z')
			const end = new Date('2026-01-20T09:00:00Z')
			const proto = create(TicketEmailSchema, {
				id: { value: 'email-1' },
				eventId: { value: 'event-1' },
				emailType: ProtoTicketEmailType.LOTTERY_INFO,
				rawBody: '抽選受付のお知らせ',
				applicationUrl: 'https://example.com/apply',
				lotteryStart: timestampFromDate(start),
				lotteryEnd: timestampFromDate(end),
				journeyStatus: TicketJourneyStatus.TRACKING,
			})

			expect(ticketEmailFrom(proto)).toEqual({
				id: 'email-1',
				eventId: 'event-1',
				emailType: 'lottery_info',
				rawBody: '抽選受付のお知らせ',
				applicationUrl: 'https://example.com/apply',
				lotteryStart: start,
				lotteryEnd: end,
				paymentDeadline: undefined,
				journeyStatus: 'tracking',
			})
		})

		it('maps a LOTTERY_RESULT proto with a payment deadline', () => {
			const deadline = new Date('2026-02-01T15:00:00Z')
			const proto = create(TicketEmailSchema, {
				id: { value: 'email-2' },
				eventId: { value: 'event-2' },
				emailType: ProtoTicketEmailType.LOTTERY_RESULT,
				rawBody: '当選のお知らせ',
				paymentDeadline: timestampFromDate(deadline),
				journeyStatus: TicketJourneyStatus.UNPAID,
			})

			const entity = ticketEmailFrom(proto)
			expect(entity.emailType).toBe('lottery_result')
			expect(entity.paymentDeadline).toEqual(deadline)
			expect(entity.journeyStatus).toBe('unpaid')
			expect(entity.lotteryStart).toBeUndefined()
			expect(entity.applicationUrl).toBeUndefined()
		})

		it('defaults id/event to empty strings and journey status to undefined when unset', () => {
			const proto = create(TicketEmailSchema, {
				emailType: ProtoTicketEmailType.LOTTERY_INFO,
				rawBody: 'body',
			})

			const entity = ticketEmailFrom(proto)
			expect(entity.id).toBe('')
			expect(entity.eventId).toBe('')
			expect(entity.journeyStatus).toBeUndefined()
		})

		it('falls back to lottery_info for an unspecified email type', () => {
			const proto = create(TicketEmailSchema, {
				emailType: ProtoTicketEmailType.UNSPECIFIED,
				rawBody: 'body',
			})
			expect(ticketEmailFrom(proto).emailType).toBe('lottery_info')
		})
	})

	describe('emailTypeTo', () => {
		it('maps domain email types to their proto enum values', () => {
			expect(emailTypeTo('lottery_info')).toBe(
				ProtoTicketEmailType.LOTTERY_INFO,
			)
			expect(emailTypeTo('lottery_result')).toBe(
				ProtoTicketEmailType.LOTTERY_RESULT,
			)
		})
	})
})
