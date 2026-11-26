import { describe, expect, it } from 'vitest'
import { zoneLabel } from './zone-name'
import { instantToWall, wallToInstant } from './zoned-time'

const wall = (month: number, day: number, hour: number, minute = 0) => ({
	year: 2027,
	month,
	day,
	hour,
	minute,
})

describe('wallToInstant', () => {
	it('reads a wall clock in its zone', () => {
		expect(wallToInstant(wall(1, 15, 19), 'Asia/Taipei')).toEqual(
			new Date('2027-01-15T11:00:00Z'),
		)
	})

	it('has no instant for a time the clocks skip moving forward', () => {
		// New York jumps from 02:00 to 03:00 on 14 March 2027.
		expect(
			wallToInstant(wall(3, 14, 2, 30), 'America/New_York'),
		).toBeUndefined()
		expect(wallToInstant(wall(3, 14, 3), 'America/New_York')).toEqual(
			new Date('2027-03-14T07:00:00Z'),
		)
	})

	it('takes the earlier instant of a time that occurs twice', () => {
		// New York repeats 01:00-02:00 on 7 November 2027.
		expect(wallToInstant(wall(11, 7, 1, 30), 'America/New_York')).toEqual(
			new Date('2027-11-07T05:30:00Z'),
		)
	})

	it('has no instant for a date that does not exist or an unknown zone', () => {
		expect(wallToInstant(wall(2, 30, 12), 'Asia/Tokyo')).toBeUndefined()
		expect(wallToInstant(wall(2, 1, 12), 'Mars/Olympus')).toBeUndefined()
	})

	it('round-trips with instantToWall', () => {
		const instant = new Date('2027-06-30T23:45:00Z')

		expect(
			wallToInstant(instantToWall(instant, 'Asia/Kolkata'), 'Asia/Kolkata'),
		).toEqual(instant)
	})
})

describe('zoneLabel', () => {
	it('names a zone by its city, and Asia/Tokyo as Japan', () => {
		expect(zoneLabel('Asia/Tokyo', 'ja')).toBe('日本時間')
		expect(zoneLabel('Asia/Tokyo', 'en')).toBe('Japan time')
		expect(zoneLabel('Asia/Taipei', 'ja')).toBe('台北時間')
		expect(zoneLabel('America/Los_Angeles', 'en')).toBe('Los Angeles time')
	})
})
