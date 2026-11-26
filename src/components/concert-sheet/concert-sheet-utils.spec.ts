import { describe, expect, it } from 'vitest'
import { useViewerZone } from '../../../test/helpers/viewer-zone'
import type { Concert } from '../../entities/concert'
import { eventCalendarUrl, eventZoneText } from './concert-sheet-utils'

const concert = (o: Partial<Concert> = {}): Concert =>
	({
		id: 'event-1',
		title: 'LIVE',
		venueName: 'The O2',
		date: new Date(2027, 1, 20),
		openTime: '18:30',
		startTime: '19:30',
		timeZone: 'Europe/London',
		...o,
	}) as Concert

useViewerZone('Asia/Tokyo')

describe('the concert sheet’s calendar link and zone', () => {
	it("adds the event at its time in the venue's zone", () => {
		const url = new URL(eventCalendarUrl(concert()))

		expect(url.searchParams.get('dates')).toBe(
			'20270220T193000/20270220T213000',
		)
		expect(url.searchParams.get('ctz')).toBe('Europe/London')
	})

	it('ends on the next date when the show runs past midnight', () => {
		const url = new URL(eventCalendarUrl(concert({ startTime: '23:00' })))

		expect(url.searchParams.get('dates')).toBe(
			'20270220T230000/20270221T010000',
		)
	})

	it("names the venue's zone and gives the fan's times for a show abroad", () => {
		expect(eventZoneText(concert(), 'ja')).toBe(
			'ロンドン時間（日本時間 2月21日(日) 03:30 / 04:30）',
		)
	})

	it('shows no zone for a show in Japan', () => {
		expect(eventZoneText(concert({ timeZone: 'Asia/Tokyo' }), 'ja')).toBe('')
	})
})
