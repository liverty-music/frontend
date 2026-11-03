import { describe, expect, it } from 'vitest'
import type { JourneyStatus } from '../../src/entities/concert'
import { JOURNEY_NAV_ORDER } from '../../src/entities/ticket-journey'

describe('JOURNEY_NAV_ORDER', () => {
	it('covers every JourneyStatus exactly once', () => {
		const all: JourneyStatus[] = [
			'tracking',
			'applied',
			'lost',
			'unpaid',
			'paid',
		]
		expect([...JOURNEY_NAV_ORDER].sort()).toEqual([...all].sort())
	})

	it('follows DOM/visual order: process then outcome', () => {
		expect(JOURNEY_NAV_ORDER).toEqual([
			'tracking',
			'applied',
			'unpaid',
			'paid',
			'lost',
		])
	})
})
