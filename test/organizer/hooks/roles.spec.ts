import { describe, expect, it } from 'vitest'
import { hasOwnerRole } from '../../../organizer/hooks/roles'

const CLAIM = 'urn:zitadel:iam:org:project:roles'

describe('hasOwnerRole', () => {
	it('returns true when the roles claim carries the owner key', () => {
		const profile = {
			[CLAIM]: { owner: { 'org-1': 'tenant.example' } },
		}
		expect(hasOwnerRole(profile)).toBe(true)
	})

	it('returns false when the claim carries only non-owner roles', () => {
		const profile = {
			[CLAIM]: { editor: { 'org-1': 'tenant.example' } },
		}
		expect(hasOwnerRole(profile)).toBe(false)
	})

	it('returns false when the roles claim is absent', () => {
		expect(hasOwnerRole({ sub: 'user-1' })).toBe(false)
	})

	it('returns false when the roles claim is not an object', () => {
		expect(hasOwnerRole({ [CLAIM]: 'owner' })).toBe(false)
		expect(hasOwnerRole({ [CLAIM]: ['owner'] })).toBe(false)
		expect(hasOwnerRole({ [CLAIM]: null })).toBe(false)
	})

	it('returns false for a null/undefined profile', () => {
		expect(hasOwnerRole(null)).toBe(false)
		expect(hasOwnerRole(undefined)).toBe(false)
	})
})
