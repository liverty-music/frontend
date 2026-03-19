import { describe, expect, it } from 'vitest'
import {
	HYPE_ORDER,
	type HypeLevel,
	isHypeMatched,
	LANE_ORDER,
	type LaneType,
} from './concert'

describe('HYPE_ORDER', () => {
	it('has an entry for every HypeLevel value', () => {
		const expected: HypeLevel[] = ['watch', 'home', 'nearby', 'away']
		expect(Object.keys(HYPE_ORDER).sort()).toEqual(expected.sort())
	})
})

describe('LANE_ORDER', () => {
	it('has an entry for every LaneType value', () => {
		const expected: LaneType[] = ['home', 'nearby', 'away']
		expect(Object.keys(LANE_ORDER).sort()).toEqual(expected.sort())
	})
})

describe('isHypeMatched', () => {
	it.each<[HypeLevel, LaneType, boolean]>([
		['away', 'home', true],
		['away', 'nearby', true],
		['away', 'away', true],
		['nearby', 'home', true],
		['nearby', 'nearby', true],
		['nearby', 'away', false],
		['home', 'home', true],
		['home', 'nearby', false],
		['home', 'away', false],
		['watch', 'home', false],
		['watch', 'nearby', false],
		['watch', 'away', false],
	])('isHypeMatched(%s, %s) === %s', (hype, lane, expected) => {
		expect(isHypeMatched(hype, lane)).toBe(expected)
	})
})
