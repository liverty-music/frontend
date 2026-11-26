import { describe, expect, it } from 'vitest'
import { resaleDeadline } from './resale-listing'

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9))
}

describe('resaleDeadline', () => {
	it('is 3 hours before an afternoon start', () => {
		expect(resaleDeadline(jst(10, 14), 'Asia/Tokyo')).toEqual(jst(10, 11))
	})

	it('is 12:00 on the day of an evening start', () => {
		expect(resaleDeadline(jst(10, 19), 'Asia/Tokyo')).toEqual(jst(10, 12))
	})

	it("is 12:00 at the venue's zone, whatever the zone", () => {
		// 19:30 in London on 20 February: the last draw is 12:00 London time.
		expect(
			resaleDeadline(new Date('2027-02-20T19:30:00Z'), 'Europe/London'),
		).toEqual(new Date('2027-02-20T12:00:00Z'))
	})

	it("is 12:00 on the venue's day even when that day is the UTC day before", () => {
		// 08:00 JST on 10 November is 23:00 UTC on 9 November.
		expect(resaleDeadline(jst(10, 8), 'Asia/Tokyo')).toEqual(jst(10, 5))
	})
})
