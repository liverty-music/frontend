import type { Concert, DateGroup } from '../../src/entities/concert'

/** Create a minimal Concert for testing. */
export function makeConcert(
	overrides: Partial<Concert> & Pick<Concert, 'id'>,
): Concert {
	return {
		artistName: 'Test Artist',
		artistId: 'artist-1',
		venueName: 'Test Venue',
		locationLabel: 'Tokyo',
		adminArea: 'JP-13',
		date: new Date('2026-04-01T19:00:00'),
		startTime: '19:00',
		title: 'Test Concert',
		sourceUrl: 'https://example.com',
		hypeLevel: 'home',
		matched: false,
		...overrides,
	}
}

/** Create a DateGroup with one event per lane for testing. */
export function makeDateGroup(overrides?: Partial<DateGroup>): DateGroup {
	return {
		label: '4月1日',
		dateKey: '2026-04-01',
		home: [makeConcert({ id: 'h1', matched: true })],
		nearby: [makeConcert({ id: 'n1', artistName: 'Nearby Artist' })],
		away: [makeConcert({ id: 'a1', artistName: 'Away Artist' })],
		...overrides,
	}
}
