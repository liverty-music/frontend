import { describe, expect, it } from 'vitest'
import type { JourneyStatus } from '../../src/entities/concert'
import {
	JOURNEY_NAV_ORDER,
	journeyNodeState,
} from '../../src/entities/ticket-journey'

describe('journeyNodeState', () => {
	it('marks the matching node as current', () => {
		expect(journeyNodeState('applied', 'applied')).toBe('current')
	})

	it('marks nodes on the path to the current status as completed', () => {
		// paid implies tracking -> applied -> unpaid all passed
		expect(journeyNodeState('tracking', 'paid')).toBe('completed')
		expect(journeyNodeState('applied', 'paid')).toBe('completed')
		expect(journeyNodeState('unpaid', 'paid')).toBe('completed')
	})

	it('marks not-yet-reached nodes as future', () => {
		expect(journeyNodeState('paid', 'applied')).toBe('future')
		expect(journeyNodeState('lost', 'applied')).toBe('future')
	})

	it('keeps the mutually exclusive branch as future, never completed', () => {
		// On the win path, the loss node is never "completed"
		expect(journeyNodeState('lost', 'paid')).toBe('future')
		// On the loss path, win-only nodes are never "completed"
		expect(journeyNodeState('unpaid', 'lost')).toBe('future')
		expect(journeyNodeState('paid', 'lost')).toBe('future')
	})

	it('treats everything as future when no status is set', () => {
		for (const node of JOURNEY_NAV_ORDER) {
			expect(journeyNodeState(node, undefined)).toBe('future')
		}
	})

	it('never reports a node as completed-by-itself', () => {
		for (const status of JOURNEY_NAV_ORDER) {
			expect(journeyNodeState(status, status)).toBe('current')
		}
	})
})

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
