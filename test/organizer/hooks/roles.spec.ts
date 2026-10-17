import { describe, expect, it } from 'vitest'
import { hasOwnerRole, tokenOrgDomains } from '../../../organizer/hooks/roles'

const CLAIM = 'urn:zitadel:iam:org:project:roles'

describe('hasOwnerRole', () => {
	it('returns true when the roles claim carries the owner key', () => {
		const profile = {
			[CLAIM]: { owner: { 'org-1': 'organization.example' } },
		}
		expect(hasOwnerRole(profile)).toBe(true)
	})

	it('returns false when the claim carries only non-owner roles', () => {
		const profile = {
			[CLAIM]: { editor: { 'org-1': 'organization.example' } },
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

describe('tokenOrgDomains', () => {
	it('returns the primary domain of every org the token has a grant in', () => {
		const profile = {
			[CLAIM]: {
				owner: { '394': 'xx-records.auth.liverty-music.app' },
				viewer: {
					'394': 'xx-records.auth.liverty-music.app',
					'777': 'yy-label.auth.liverty-music.app',
				},
			},
		}
		expect(tokenOrgDomains(profile)).toEqual([
			'xx-records.auth.liverty-music.app',
			'yy-label.auth.liverty-music.app',
		])
	})

	it('returns nothing for a missing or malformed claim', () => {
		expect(tokenOrgDomains(null)).toEqual([])
		expect(tokenOrgDomains({ [CLAIM]: ['owner'] })).toEqual([])
		expect(tokenOrgDomains({ [CLAIM]: { owner: { '394': 7 } } })).toEqual([])
	})
})
