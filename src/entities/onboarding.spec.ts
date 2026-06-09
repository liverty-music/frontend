// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { LEGACY_COMPLETED_STEPS } from './onboarding'

describe('LEGACY_COMPLETED_STEPS', () => {
	it('contains the legacy completed markers', () => {
		expect(LEGACY_COMPLETED_STEPS.has('completed')).toBe(true)
		// Legacy numeric index '7' mapped to the old COMPLETED step.
		expect(LEGACY_COMPLETED_STEPS.has('7')).toBe(true)
	})

	it('excludes non-completed legacy step values', () => {
		for (const v of ['lp', 'discovery', 'dashboard', 'my-artists', 'detail']) {
			expect(LEGACY_COMPLETED_STEPS.has(v)).toBe(false)
		}
	})
})
