import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import { receptionWindowOf } from '../../../organizer/reception-links/reception-window'

function event(start?: string, doors?: string) {
	return create(EventSchema, {
		localDate: { value: { year: 2026, month: 11, day: 20 } },
		...(start
			? { startTime: { value: timestampFromDate(new Date(start)) } }
			: {}),
		...(doors
			? { openTime: { value: timestampFromDate(new Date(doors)) } }
			: {}),
	})
}

describe('receptionWindowOf', () => {
	it('opens 3 hours before doors and closes at 04:00 JST the next day', () => {
		const w = receptionWindowOf(
			event('2026-11-20T09:00:00Z', '2026-11-20T08:30:00Z'),
		)
		expect(w?.open.toISOString()).toBe('2026-11-20T05:30:00.000Z')
		expect(w?.close.toISOString()).toBe('2026-11-20T19:00:00.000Z')
	})

	it('falls back to the start time when doors are not announced', () => {
		const w = receptionWindowOf(event('2026-11-20T09:00:00Z'))
		expect(w?.open.toISOString()).toBe('2026-11-20T06:00:00.000Z')
	})

	it('has no window without a start time', () => {
		expect(
			receptionWindowOf(event(undefined, '2026-11-20T08:30:00Z')),
		).toBeNull()
	})
})
