import { describe, expect, it } from 'vitest'
import {
	type EventWhen,
	formatEventWhen,
	formatMomentAt,
	formatSaleWindow,
} from '../../../organizer/i18n/format'
import {
	instantOfInput,
	toDateTimeInput,
	unsetPartOf,
	wallOfInput,
} from '../../../organizer/i18n/wall-input'

const I18N = 'components/infrastructure/organizer/web/global/i18n'

const when = (
	date: [number, number, number],
	time: [number, number] | undefined,
	zone: string | undefined,
): EventWhen => ({
	date: { year: date[0], month: date[1], day: date[2] },
	...(time ? { time: { hour: time[0], minute: time[1] } } : {}),
	zone,
})

describe('an Event in the zone of its Venue', () => {
	it(`@spec ${I18N} "Event abroad"`, () => {
		const london = when([2027, 2, 20], [19, 30], 'Europe/London')
		expect(formatEventWhen(london, 'ja')).toBe(
			'2月20日(土) 19:30 ロンドン時間（日本時間 2月21日(日) 04:30）',
		)
		expect(formatEventWhen(london, 'en')).toBe(
			'Sat, Feb 20, 19:30 London time (Japan time Feb 21, 04:30)',
		)
	})

	it(`@spec ${I18N} "Member abroad"`, () => {
		// The Venue's zone decides, not the device's: the same wall clock reads
		// the same wherever the member is (no function here reads the device zone).
		const tokyo = when([2026, 11, 3], [18, 0], 'Asia/Tokyo')
		expect(formatEventWhen(tokyo, 'ja')).toBe('11月3日(火) 18:00 日本時間')
		expect(formatEventWhen(tokyo, 'en')).toBe('Tue, Nov 3, 18:00 Japan time')
	})

	it(`@spec ${I18N} "Event in another zone with Japan's offset"`, () => {
		const seoul = when([2027, 1, 15], [18, 30], 'Asia/Seoul')
		expect(formatEventWhen(seoul, 'ja')).toBe(
			'1月15日(金) 18:30 ソウル時間（日本時間 18:30）',
		)
	})

	it('shows only the day of an Event with no start time', () => {
		expect(
			formatEventWhen(when([2026, 12, 20], undefined, 'Asia/Tokyo'), 'ja'),
		).toBe('12月20日(日)')
	})

	it('names no zone for a Venue that has none', () => {
		expect(formatEventWhen(when([2026, 11, 3], [18, 0], undefined), 'ja')).toBe(
			'11月3日(火) 18:00',
		)
	})
})

describe('a sale in its own zone', () => {
	it(`@spec ${I18N} "Sale window in its own zone"`, () => {
		const window = {
			start: { year: 2027, month: 2, day: 1, hour: 12, minute: 0 },
			zone: 'Asia/Taipei',
		}
		// A member whose device is set to Japan time still reads the sale's own zone.
		expect(formatSaleWindow(window, 'ja')).toBe('2月1日(月) 12:00 台北時間 〜')
		expect(
			formatSaleWindow(
				{
					start: { year: 2027, month: 2, day: 1, hour: 12, minute: 0 },
					end: { year: 2027, month: 2, day: 10, hour: 23, minute: 59 },
					zone: 'Asia/Seoul',
				},
				'ja',
			),
		).toBe('2月1日(月) 12:00 〜 2月10日(水) 23:59 ソウル時間')
	})
})

describe('a moment in the past about an event', () => {
	it(`@spec ${I18N} "Scanner opened abroad"`, () => {
		// 18:05 in London on 2027-02-20 (UTC+0), whatever the device's zone.
		const opened = new Date('2027-02-20T18:05:00Z')
		expect(formatMomentAt({ at: opened, zone: 'Europe/London' }, 'ja')).toBe(
			'2月20日(土) 18:05 ロンドン時間',
		)
	})
})

describe('what a member enters is read in the zone the field names', () => {
	it(`@spec ${I18N} "Entering a sale window abroad"`, () => {
		const instant = instantOfInput(
			{ date: '2026-10-10', time: '12:00' },
			'Asia/Tokyo',
		)
		// 12:00 Japan time is 03:00 UTC, not 12:00 on the device's clock.
		expect(instant?.toISOString()).toBe('2026-10-10T03:00:00.000Z')
		expect(
			instantOfInput(
				{ date: '2026-10-10', time: '12:00' },
				'Europe/London',
			)?.toISOString(),
		).toBe('2026-10-10T11:00:00.000Z')
	})

	it('reads back the fields it was given', () => {
		const wall = wallOfInput({ date: '2026-10-10', time: '12:00' })
		expect(wall && toDateTimeInput(wall)).toEqual({
			date: '2026-10-10',
			time: '12:00',
		})
	})

	it('rejects a time the clocks skip', () => {
		expect(
			instantOfInput({ date: '2027-03-14', time: '02:30' }, 'America/New_York'),
		).toBeUndefined()
		expect(
			instantOfInput({ date: '2027-03-14', time: '03:30' }, 'America/New_York'),
		).toBeDefined()
	})

	it('names the part that is missing, the date first', () => {
		expect(unsetPartOf({ date: '', time: '' })).toBe('date')
		expect(unsetPartOf({ date: '2026-02-30', time: '10:00' })).toBe('date')
		expect(unsetPartOf({ date: '2026-10-10', time: '' })).toBe('time')
		expect(unsetPartOf({ date: '2026-10-10', time: '24:00' })).toBe('time')
		expect(unsetPartOf({ date: '2026-10-10', time: '23:55' })).toBeNull()
	})
})
