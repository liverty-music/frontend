import { describe, expect, it, vi } from 'vitest'
import { TapEffects } from './tap-effects'

describe('TapEffects over-inflation burst', () => {
	it('fires onBurst only after the inflation pre-roll completes', () => {
		const effects = new TapEffects(false)
		const onBurst = vi.fn()

		effects.addPress(10, 20, 30, 142, onBurst)
		expect(effects.isActive).toBe(true)

		// One short frame is not enough to complete the ~40ms inflation.
		effects.update(10)
		expect(onBurst).not.toHaveBeenCalled()

		// Enough elapsed time ruptures the bubble and fires the burst.
		effects.update(40)
		expect(onBurst).toHaveBeenCalledTimes(1)
		expect(effects.isActive).toBe(false)
	})

	it('fires onBurst immediately and renders nothing under reduced motion', () => {
		const effects = new TapEffects(true)
		const onBurst = vi.fn()

		effects.addPress(10, 20, 30, 142, onBurst)

		expect(onBurst).toHaveBeenCalledTimes(1)
		expect(effects.isActive).toBe(false)
	})

	it('suppresses the rupture ring under reduced motion', () => {
		const reduced = new TapEffects(true)
		reduced.addRupture(10, 20, 30)
		expect(reduced.isActive).toBe(false)

		const normal = new TapEffects(false)
		normal.addRupture(10, 20, 30)
		expect(normal.isActive).toBe(true)
	})
})
