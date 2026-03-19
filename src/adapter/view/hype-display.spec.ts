import { describe, expect, it } from 'vitest'
import type { Hype } from '../../entities/follow'
import { HYPE_TIERS } from './hype-display'

describe('HYPE_TIERS', () => {
	const ALL_HYPES: Hype[] = ['watch', 'home', 'nearby', 'away']

	it('has an entry for every Hype value', () => {
		expect(Object.keys(HYPE_TIERS).sort()).toEqual([...ALL_HYPES].sort())
	})

	it.each(ALL_HYPES)('%s has non-empty labelKey and icon', (hype) => {
		const tier = HYPE_TIERS[hype]
		expect(tier.labelKey).toBeTruthy()
		expect(tier.icon).toBeTruthy()
	})
})
