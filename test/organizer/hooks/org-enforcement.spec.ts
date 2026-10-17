import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	enforceIntendedOrg,
	ORG_MISMATCH_FLAG,
} from '../../../organizer/hooks/org-enforcement'
import { createMockLogger } from '../../helpers/mock-logger'

const ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'
const logger = createMockLogger()

function profileInOrg(orgId: string): Record<string, unknown> {
	return { [ROLES_CLAIM]: { owner: { [orgId]: 'organization.example' } } }
}

function auth() {
	return { signIn: vi.fn().mockResolvedValue(undefined) }
}

describe('enforceIntendedOrg', () => {
	beforeEach(() => {
		window.sessionStorage.clear()
	})

	it('returns ok when the token is in the intended org', async () => {
		const a = auth()
		const gate = await enforceIntendedOrg(
			a,
			'org-1',
			profileInOrg('org-1'),
			logger,
		)
		expect(gate).toBe('ok')
		expect(a.signIn).not.toHaveBeenCalled()
	})

	it('returns ok when the token is in the org named by primary domain', async () => {
		const a = auth()
		const gate = await enforceIntendedOrg(
			a,
			'xx-records.auth.liverty-music.app',
			{
				[ROLES_CLAIM]: {
					owner: { '394': 'xx-records.auth.liverty-music.app' },
				},
			},
			logger,
		)
		expect(gate).toBe('ok')
		expect(a.signIn).not.toHaveBeenCalled()
	})

	it('returns ok when there is no intended org to enforce', async () => {
		const a = auth()
		const gate = await enforceIntendedOrg(
			a,
			undefined,
			profileInOrg('org-1'),
			logger,
		)
		expect(gate).toBe('ok')
	})

	it('returns ok (defers to the role gate) when the token has no org grant', async () => {
		const a = auth()
		const gate = await enforceIntendedOrg(
			a,
			'org-1',
			{ [ROLES_CLAIM]: {} },
			logger,
		)
		expect(gate).toBe('ok')
		expect(a.signIn).not.toHaveBeenCalled()
	})

	// @spec stories/sign-in-as-organizer "A reused or mismatched session does not silently onboard the wrong member"
	it('re-auths once when the token belongs to a different org', async () => {
		const a = auth()
		const gate = await enforceIntendedOrg(
			a,
			'org-1',
			profileInOrg('org-2'),
			logger,
			'ja',
		)
		expect(gate).toBe('reauth')
		// The re-auth opens the hosted login in the console's language.
		expect(a.signIn).toHaveBeenCalledWith({ forceLogin: true, uiLocales: 'ja' })
		expect(window.sessionStorage.getItem(ORG_MISMATCH_FLAG)).toBe('1')
	})

	// @spec stories/sign-in-as-organizer "A hint for another org grants nothing"
	it('denies without a second re-auth once the one-shot flag is set', async () => {
		window.sessionStorage.setItem(ORG_MISMATCH_FLAG, '1')
		const a = auth()
		const gate = await enforceIntendedOrg(
			a,
			'org-1',
			profileInOrg('org-2'),
			logger,
		)
		expect(gate).toBe('denied')
		expect(a.signIn).not.toHaveBeenCalled()
	})

	it('clears the one-shot flag on an acceptable outcome', async () => {
		window.sessionStorage.setItem(ORG_MISMATCH_FLAG, '1')
		const a = auth()
		await enforceIntendedOrg(a, 'org-1', profileInOrg('org-1'), logger)
		expect(window.sessionStorage.getItem(ORG_MISMATCH_FLAG)).toBeNull()
	})
})
