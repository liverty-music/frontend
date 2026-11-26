import { describe, expect, it } from 'vitest'
import { instantToWall } from '../../../shared/lib/zoned-time/zoned-time'
import {
	formatEventMoment,
	formatEventTimes,
	formatInstantAtVenue,
	formatPastMoment,
	formatSaleMoment,
} from '../../../src/lib/time-format/time-format'

const TOKYO = 'Asia/Tokyo'
const LONDON = 'Europe/London'

const date = (year: number, month: number, day: number) => ({
	year,
	month,
	day,
})
const at = (hour: number, minute = 0) => ({ hour, minute })

describe('the fan app shows each time in the zone it belongs to', () => {
	it('@spec components/infrastructure/fan/web/global/i18n "Event and fan in Japan"', () => {
		const times = formatEventTimes(
			{ date: date(2026, 11, 3), start: at(18), timeZone: TOKYO },
			'ja',
			TOKYO,
		)

		expect(times).toEqual({ open: '', start: '18:00', zone: '' })
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Event abroad seen from Japan"', () => {
		expect(
			formatEventMoment(date(2027, 2, 20), at(19, 30), LONDON, 'ja', TOKYO),
		).toBe('2月20日(土) 19:30 ロンドン時間（日本時間 2月21日(日) 04:30）')
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Event in Japan seen from abroad"', () => {
		expect(
			formatEventMoment(date(2026, 11, 3), at(18), TOKYO, 'ja', LONDON),
		).toBe('11月3日(火) 18:00 日本時間（ロンドン時間 09:00）')
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Event in Taipei seen from Japan"', () => {
		const times = formatEventTimes(
			{ date: date(2027, 1, 15), start: at(19), timeZone: 'Asia/Taipei' },
			'ja',
			TOKYO,
		)

		expect(`${times.start} ${times.zone}`).toBe(
			'19:00 台北時間（日本時間 20:00）',
		)
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Another zone with the same offset"', () => {
		const times = formatEventTimes(
			{ date: date(2027, 1, 15), start: at(18, 30), timeZone: 'Asia/Seoul' },
			'ja',
			TOKYO,
		)

		expect(times).toEqual({ open: '', start: '18:30', zone: '' })
	})

	it('@spec components/infrastructure/fan/web/global/i18n "English display language"', () => {
		expect(
			formatEventMoment(date(2027, 2, 20), at(19, 30), LONDON, 'en', TOKYO),
		).toBe('Sat, Feb 20, 19:30 London time (Japan time Feb 21, 04:30)')
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Sale abroad seen from Japan"', () => {
		// 12:00 on 1 February in Taipei is 04:00 UTC.
		expect(
			formatSaleMoment(
				new Date('2027-02-01T04:00:00Z'),
				'Asia/Taipei',
				'ja',
				TOKYO,
			),
		).toBe('2月1日(月) 13:00 日本時間')
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Sale in the fan\'s own zone"', () => {
		expect(
			formatSaleMoment(new Date('2026-11-01T01:00:00Z'), TOKYO, 'ja', TOKYO),
		).toBe('11月1日(日) 10:00')
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Resale deadline abroad"', () => {
		// 12:00 on 20 February in London is 12:00 UTC.
		expect(
			formatInstantAtVenue(
				new Date('2027-02-20T12:00:00Z'),
				LONDON,
				'ja',
				TOKYO,
			),
		).toBe('2月20日(土) 12:00 ロンドン時間（日本時間 21:00）')
	})

	it('@spec components/infrastructure/fan/web/global/i18n "Admission time"', () => {
		// 18:10 on 20 February in London.
		expect(
			formatPastMoment(new Date('2027-02-20T18:10:00Z'), 'ja', TOKYO),
		).toBe('2月21日(日) 03:10')
	})

	it('shows the venue zone name once, after both times, with the fan times in order', () => {
		const times = formatEventTimes(
			{
				date: date(2027, 2, 20),
				open: at(18, 30),
				start: at(19, 30),
				timeZone: LONDON,
			},
			'ja',
			TOKYO,
		)

		expect(times).toEqual({
			open: '18:30',
			start: '19:30',
			zone: 'ロンドン時間（日本時間 2月21日(日) 03:30 / 04:30）',
		})
	})

	it('compares offsets at the moment, across a daylight-saving change', () => {
		// London and Lisbon always agree; London and Reykjavik only in winter.
		const show = (month: number) =>
			formatEventTimes(
				{ date: date(2027, month, 10), start: at(19), timeZone: LONDON },
				'en',
				'Atlantic/Reykjavik',
			).zone

		expect(show(1)).toBe('')
		expect(show(7)).toBe('London time (Reykjavik time 18:00)')
	})

	it('leaves a venue without a zone unlabelled', () => {
		const instant = new Date('2027-02-20T12:00:00Z')
		const wall = instantToWall(instant, LONDON)

		expect(formatInstantAtVenue(instant, undefined, 'ja', LONDON)).toBe(
			formatEventMoment(wall, wall, undefined, 'ja', LONDON),
		)
	})
})
