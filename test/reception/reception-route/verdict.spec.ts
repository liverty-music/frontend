import { RejectedScanReason } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/rejected_scan_pb.js'
import { AdmitResponseSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception/v1/reception_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	toVerdict,
	undecidedVerdict,
} from '../../../reception/reception-route/verdict'
import {
	formatJstDateTime,
	formatJstTime,
} from '../../../shared/lib/reception/jst-format'

describe('toVerdict', () => {
	it('has a reason and a next step for every whole-scan reason', () => {
		for (const reason of [
			RejectedScanReason.FORGED,
			RejectedScanReason.EXPIRED,
			RejectedScanReason.OTHER_EVENT,
		]) {
			const v = toVerdict(
				create(AdmitResponseSchema, { rejectedScanReason: reason }),
			)
			expect(v.tone).toBe('ng')
			expect(v.headline).toBe('NG')
			expect(v.admittedLabel).toBe('')
			expect(v.reasons).toHaveLength(1)
			expect(v.reasons[0].reason).not.toBe('')
			expect(v.reasons[0].nextStep).not.toBe('')
		}
	})

	it('words a forged code as not a valid entry code from the registered phone', () => {
		const v = toVerdict(
			create(AdmitResponseSchema, {
				rejectedScanReason: RejectedScanReason.FORGED,
			}),
		)
		expect(v.reasons[0].reason).toContain('有効な入場QRコードではありません')
		expect(v.reasons[0].nextStep).toContain(
			'登録したスマートフォンのチケット画面',
		)
	})

	it('groups a partial group by reason and earlier admission', () => {
		const at = timestampFromDate(new Date('2026-11-20T09:32:00Z'))
		const v = toVerdict(
			create(AdmitResponseSchema, {
				admittedTicketCount: 2,
				rejectedTickets: [
					{
						reason: RejectedScanReason.ALREADY_ADMITTED,
						earlierAdmitTime: at,
						earlierReceptionLinkNumber: { value: 2 },
					},
					{ reason: RejectedScanReason.NOT_HOLDER },
					{
						reason: RejectedScanReason.ALREADY_ADMITTED,
						earlierAdmitTime: at,
						earlierReceptionLinkNumber: { value: 2 },
					},
					{
						// The link number could not be read: the time alone.
						reason: RejectedScanReason.ALREADY_ADMITTED,
						earlierAdmitTime: at,
					},
				],
			}),
		)
		expect(v.tone).toBe('partial')
		expect(v.headline).toBe('OK')
		expect(v.admittedLabel).toBe('2名')
		expect(v.reasons.map((r) => [r.count, r.detail])).toEqual([
			[2, '18:32 受付2'],
			[1, ''],
			[1, '18:32'],
		])
		expect(v.reasons[1].reason).toBe('本人のチケットではありません')
	})

	it('is NG when every presented ticket is refused', () => {
		const v = toVerdict(
			create(AdmitResponseSchema, {
				rejectedTickets: [{ reason: RejectedScanReason.VOIDED }],
			}),
		)
		expect(v.tone).toBe('ng')
		expect(v.reasons[0].reason).toContain('払い戻し')
	})

	it('never makes an undecided scan look like OK', () => {
		const v = undecidedVerdict()
		expect(v.tone).toBe('undecided')
		expect(v.headline).not.toContain('OK')
		expect(v.admittedCount).toBe(0)
	})
})

describe('Japan time formatting', () => {
	it('formats in Asia/Tokyo whatever the device zone', () => {
		const d = new Date('2026-11-20T06:00:00Z')
		expect(formatJstDateTime(d)).toBe('2026-11-20 15:00')
		expect(formatJstTime(new Date('2026-11-20T15:05:00Z'))).toBe('00:05')
	})
})
