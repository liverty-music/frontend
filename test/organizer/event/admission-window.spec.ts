import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { admissionWindowOf } from '../../../organizer/event/reception-tab/admission-window'
import { timeOfDayInit } from '../../../shared/lib/zoned-time/proto'

function event(
	start?: [number, number],
	doors?: [number, number],
	zone = 'Asia/Tokyo',
) {
	const time = (t: [number, number]) => ({
		value: timeOfDayInit({ hour: t[0], minute: t[1] }),
	})
	return create(EventSchema, {
		localDate: { value: { year: 2026, month: 11, day: 20 } },
		venue: { timeZone: { value: zone } },
		...(start ? { startTime: time(start) } : {}),
		...(doors ? { openTime: time(doors) } : {}),
	})
}

describe('admissionWindowOf', () => {
	it('opens 3 hours before doors and closes at 04:00 the next day at the venue', () => {
		const w = admissionWindowOf(event([18, 0], [17, 30]))
		// 17:30 JST is 08:30 UTC; 04:00 JST on 21 November is 19:00 UTC on the 20th.
		expect(w?.open.toISOString()).toBe('2026-11-20T05:30:00.000Z')
		expect(w?.close.toISOString()).toBe('2026-11-20T19:00:00.000Z')
		expect(w?.zone).toBe('Asia/Tokyo')
	})

	it('reads the window in the venue zone, not Japan time', () => {
		const w = admissionWindowOf(event([19, 30], [18, 30], 'Europe/London'))
		// 18:30 London (UTC+0 in November): opens 15:30 UTC, closes 04:00 UTC on the 21st.
		expect(w?.open.toISOString()).toBe('2026-11-20T15:30:00.000Z')
		expect(w?.close.toISOString()).toBe('2026-11-21T04:00:00.000Z')
		expect(w?.closeAt).toEqual({ at: w?.close, zone: 'Europe/London' })
	})

	it('falls back to the start time when doors are not announced', () => {
		const w = admissionWindowOf(event([18, 0]))
		expect(w?.open.toISOString()).toBe('2026-11-20T06:00:00.000Z')
	})

	it('has no window without a start time', () => {
		expect(admissionWindowOf(event(undefined, [17, 30]))).toBeNull()
	})
})
