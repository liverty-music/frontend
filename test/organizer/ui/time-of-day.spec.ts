import { describe, expect, it } from 'vitest'
import {
	HOURS,
	MINUTES,
	minuteChoices,
	partsOf,
	timeOf,
} from '../../../organizer/ui/console-time-field/time-of-day'

describe('time of day', () => {
	it('offers hours 00 to 23 and minutes in 5-minute steps', () => {
		expect(HOURS).toHaveLength(24)
		expect(HOURS[0]).toBe('00')
		expect(HOURS[23]).toBe('23')
		expect(MINUTES).toEqual([
			'00',
			'05',
			'10',
			'15',
			'20',
			'25',
			'30',
			'35',
			'40',
			'45',
			'50',
			'55',
		])
	})

	it('splits HH:mm into its parts', () => {
		expect(partsOf('19:00')).toEqual({ hour: '19', minute: '00' })
		expect(partsOf('00:05')).toEqual({ hour: '00', minute: '05' })
		expect(partsOf('18:07')).toEqual({ hour: '18', minute: '07' })
	})

	it('reads an empty or malformed time as unset', () => {
		for (const value of ['', '24:00', '7:00', '19:60', '19:00:00', 'abc']) {
			expect(partsOf(value)).toEqual({ hour: '', minute: '' })
		}
	})

	it('joins the parts only when both are chosen', () => {
		expect(timeOf({ hour: '17', minute: '30' })).toBe('17:30')
		expect(timeOf({ hour: '17', minute: '' })).toBe('')
		expect(timeOf({ hour: '', minute: '30' })).toBe('')
	})

	it('keeps an off-step minute among the choices, in order', () => {
		expect(minuteChoices('')).toBe(MINUTES)
		expect(minuteChoices('30')).toBe(MINUTES)
		const choices = minuteChoices('07')
		expect(choices).toHaveLength(13)
		expect(choices.slice(0, 4)).toEqual(['00', '05', '07', '10'])
	})
})
