import { describe, expect, it } from 'vitest'
import {
	applyOrgPin,
	ORG_ID_STORAGE_KEY,
	ORG_SHORT_NAME_STORAGE_KEY,
	confirmPendingOrgPin,
	type OrgPin,
	PENDING_ORG_PIN_STORAGE_KEY,
	primaryDomainOf,
	readOrgPinFromSearch,
	resolveOrgPin,
} from '../../../organizer/services/org-handle'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockLocalStorage } from '../../helpers/mock-local-storage'

/** The address the identity provider returns to after a sign-in. */
const CALLBACK = '/auth/callback'

describe('readOrgPinFromSearch', () => {
	it('reads an Organization id from org_id', () => {
		expect(readOrgPinFromSearch('?org_id=394467236179345732')).toEqual({
			kind: 'id',
			orgId: '394467236179345732',
		})
	})

	it('reads a short name from org', () => {
		expect(readOrgPinFromSearch('?org=xx-records')).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
	})

	it('prefers org_id over org when both are present', () => {
		expect(readOrgPinFromSearch('?org=xx-records&org_id=394')).toEqual({
			kind: 'id',
			orgId: '394',
		})
	})

	it('trims surrounding whitespace', () => {
		expect(readOrgPinFromSearch('?org_id=%20org-7%20')).toEqual({
			kind: 'id',
			orgId: 'org-7',
		})
		expect(readOrgPinFromSearch('?org=%20xx-records%20')).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
	})

	it.each([
		['an Organization id from an older link', '394467236179345732'],
		['a name with a space', 'XX%20Records'],
		['an upper-case name', 'XX-Records'],
		['a too-short name', 'ab'],
		['a reserved name', 'admin'],
		['the product organization', 'liverty-music'],
	])('ignores org carrying %s', (_label, value) => {
		expect(readOrgPinFromSearch(`?org=${value}`)).toBeNull()
	})

	it('returns null when the address names no Organization', () => {
		expect(readOrgPinFromSearch('?foo=bar')).toBeNull()
		expect(readOrgPinFromSearch('')).toBeNull()
		expect(readOrgPinFromSearch('?org_id=%20%20')).toBeNull()
	})
})

describe('resolveOrgPin', () => {
	/** The device's store (localStorage) and the tab's (sessionStorage). */
	function stores(remembered: Record<string, string> = {}) {
		return {
			local: createMockLocalStorage(remembered),
			tab: createMockLocalStorage(),
		}
	}

	// The invite's default redirect returns to /?org_id=<id>; the console pins
	// sign-in to that Organization's login policy.
	// @spec stories/sign-in-as-organizer "Invited owner lands on the console after accepting the invite"
	it('returns an id from the address and keeps it for the callback, not as remembered', () => {
		const { local, tab } = stores({ [ORG_SHORT_NAME_STORAGE_KEY]: 'old-label' })
		const result = resolveOrgPin('?org_id=org-abc', local, '/', tab)

		expect(result).toEqual({ kind: 'id', orgId: 'org-abc' })
		expect(local.getItem(ORG_ID_STORAGE_KEY)).toBeNull()
		expect(local.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBe('old-label')
		// The callback of the sign-in it starts names the same Organization.
		expect(resolveOrgPin('', local, CALLBACK, tab)).toEqual(result)
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Link opened"
	it('remembers the Organizer of an opened sign-in link once the sign-in admits the member', () => {
		const { local, tab } = stores({ [ORG_ID_STORAGE_KEY]: 'org-old' })

		// The link from the email: /?org=<short name>.
		const opened = resolveOrgPin('?org=xx-records', local, '/', tab)
		// The sign-in returns to the callback, and the guard admits the member.
		const atCallback = resolveOrgPin('', local, CALLBACK, tab)
		confirmPendingOrgPin(local, tab, atCallback as OrgPin)
		// The next visit on the device, without the link.
		const next = resolveOrgPin('', local, '/', createMockLocalStorage())

		const pin = { kind: 'shortName', shortName: 'xx-records' }
		expect(opened).toEqual(pin)
		expect(atCallback).toEqual(pin)
		expect(next).toEqual(pin)
		expect(local.getItem(ORG_ID_STORAGE_KEY)).toBeNull()
		expect(tab.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	// liverty-music/frontend#1076: a link to an Organizer that does not exist
	// (or was deactivated) fails at sign-in. It must not stick to the device.
	// @spec components/infrastructure/organizer/web/global/hosted-login "Link to an Organizer that does not exist"
	it('does not remember a pin from the address that no sign-in admitted', () => {
		const { local, tab } = stores()

		resolveOrgPin('?org=gone-records', local, '/', tab)
		// The sign-in failed; the next visit opens the console without the link.
		const next = resolveOrgPin('', local, '/', tab)

		expect(next).toBeNull()
		expect(local.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		expect(tab.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	// @spec components/infrastructure/organizer/web/global/hosted-login "Failed link keeps the remembered Organization"
	it('keeps the remembered pin when a link to another Organizer fails at sign-in', () => {
		const { local, tab } = stores({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records',
		})
		const remembered = { kind: 'shortName', shortName: 'xx-records' }

		expect(resolveOrgPin('?org=gone-records', local, '/', tab)).toEqual({
			kind: 'shortName',
			shortName: 'gone-records',
		})
		expect(resolveOrgPin('', local, '/', tab)).toEqual(remembered)
		// A later sign-in started from the remembered pin returns to a callback
		// that names the remembered Organization, not the failed one.
		expect(resolveOrgPin('', local, CALLBACK, tab)).toEqual(remembered)
	})

	it("keeps a tab's pending pin when another tab loads the console", () => {
		const { local, tab } = stores({ [ORG_ID_STORAGE_KEY]: 'org-a' })
		resolveOrgPin('?org=xx-records', local, '/', tab)

		// Another tab, with its own sessionStorage, opens the console.
		resolveOrgPin('', local, '/', createMockLocalStorage())

		expect(resolveOrgPin('', local, CALLBACK, tab)).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
	})

	it('falls back to the pin remembered on the device', () => {
		expect(
			resolveOrgPin(
				'',
				createMockLocalStorage({ [ORG_ID_STORAGE_KEY]: 'org-remembered' }),
				'/',
				createMockLocalStorage(),
			),
		).toEqual({ kind: 'id', orgId: 'org-remembered' })
		expect(
			resolveOrgPin(
				'',
				createMockLocalStorage({ [ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records' }),
				CALLBACK,
				createMockLocalStorage(),
			),
		).toEqual({ kind: 'shortName', shortName: 'xx-records' })
	})

	it('does not persist anything when reading from storage', () => {
		const { local, tab } = stores({ [ORG_ID_STORAGE_KEY]: 'org-remembered' })
		resolveOrgPin('', local, '/', tab)
		expect(local.setItem).not.toHaveBeenCalled()
		expect(tab.setItem).not.toHaveBeenCalled()
	})

	it('prefers the address over a remembered pin without overwriting it', () => {
		const { local, tab } = stores({ [ORG_ID_STORAGE_KEY]: 'org-old' })
		expect(resolveOrgPin('?org_id=org-new', local, '/', tab)).toEqual({
			kind: 'id',
			orgId: 'org-new',
		})
		expect(local.getItem(ORG_ID_STORAGE_KEY)).toBe('org-old')
	})

	it('returns null on a device that remembers nothing and an address that names nothing', () => {
		const { local, tab } = stores()
		expect(resolveOrgPin('', local, '/', tab)).toBeNull()
		expect(resolveOrgPin('', local, CALLBACK, tab)).toBeNull()
	})

	it('ignores a malformed pending pin at the callback', () => {
		const { local, tab } = stores({ [ORG_ID_STORAGE_KEY]: 'org-remembered' })
		tab.setItem(PENDING_ORG_PIN_STORAGE_KEY, '{not json')
		expect(resolveOrgPin('', local, CALLBACK, tab)).toEqual({
			kind: 'id',
			orgId: 'org-remembered',
		})
	})

	it('degrades to no pin when reading storage throws', () => {
		const storage = {
			getItem: () => {
				throw new Error('storage disabled')
			},
			setItem: () => {},
			removeItem: () => {},
		}
		expect(resolveOrgPin('', storage, '/', storage)).toBeNull()
		expect(resolveOrgPin('', storage, CALLBACK, storage)).toBeNull()
	})

	it('still returns the pin from the address when persisting it throws', () => {
		const storage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded')
			},
			removeItem: () => {},
		}
		expect(resolveOrgPin('?org=xx-records', storage, '/', storage)).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
	})
})

describe('confirmPendingOrgPin', () => {
	it('remembers the pending pin in place of one of the other kind and ends the pending sign-in', () => {
		const local = createMockLocalStorage({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'old-label',
		})
		const tab = createMockLocalStorage({
			[PENDING_ORG_PIN_STORAGE_KEY]: '{"orgId":"org-new"}',
		})

		confirmPendingOrgPin(local, tab, { kind: 'id', orgId: 'org-new' })

		expect(local.getItem(ORG_ID_STORAGE_KEY)).toBe('org-new')
		expect(local.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		expect(tab.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	it('writes nothing when no sign-in is pending in this tab', () => {
		const local = createMockLocalStorage({ [ORG_ID_STORAGE_KEY]: 'org-b' })

		confirmPendingOrgPin(local, createMockLocalStorage(), {
			kind: 'id',
			orgId: 'org-a',
		})

		expect(local.setItem).not.toHaveBeenCalled()
		expect(local.removeItem).not.toHaveBeenCalled()
	})

	// A page restored by Back after a sign-in to another Organizer failed in
	// the same tab: that sign-in's pin is pending, but this document enforces
	// its own Organization.
	it('drops, never remembers, a pending pin that is not the enforced one', () => {
		const local = createMockLocalStorage({ [ORG_ID_STORAGE_KEY]: 'org-r' })
		const tab = createMockLocalStorage({
			[PENDING_ORG_PIN_STORAGE_KEY]: '{"shortName":"gone-records"}',
		})

		confirmPendingOrgPin(local, tab, { kind: 'id', orgId: 'org-r' })

		expect(local.getItem(ORG_ID_STORAGE_KEY)).toBe('org-r')
		expect(local.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		expect(tab.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	it('does not throw when the store is unavailable', () => {
		const tab = createMockLocalStorage({
			[PENDING_ORG_PIN_STORAGE_KEY]: '{"orgId":"org-1"}',
		})
		const local = {
			getItem: () => null,
			setItem: () => {
				throw new Error('storage disabled')
			},
			removeItem: () => {},
		}
		expect(() =>
			confirmPendingOrgPin(local, tab, { kind: 'id', orgId: 'org-1' }),
		).not.toThrow()
	})
})

describe('applyOrgPin', () => {
	const config = createMockAppConfig({
		zitadelIssuer: 'https://auth.liverty-music.app',
		zitadelOrgId: undefined,
	})

	it('derives the primary domain from the identity provider host', () => {
		expect(
			primaryDomainOf('xx-records', 'https://auth.liverty-music.app'),
		).toBe('xx-records.auth.liverty-music.app')
		expect(
			primaryDomainOf('xx-records', 'https://auth.dev.liverty-music.app/'),
		).toBe('xx-records.auth.dev.liverty-music.app')
	})

	it('names the Organization by id for an id pin', () => {
		const pinned = applyOrgPin(config, { kind: 'id', orgId: '394' })
		expect(pinned.zitadelOrgId).toBe('394')
		expect(pinned.zitadelOrgPrimaryDomain).toBeUndefined()
	})

	it('names the Organization by primary domain for a short-name pin', () => {
		const pinned = applyOrgPin(config, {
			kind: 'shortName',
			shortName: 'xx-records',
		})
		expect(pinned.zitadelOrgPrimaryDomain).toBe(
			'xx-records.auth.liverty-music.app',
		)
		expect(pinned.zitadelOrgId).toBeUndefined()
	})

	it('leaves the config without an Organization when there is no pin', () => {
		expect(applyOrgPin(config, null)).toBe(config)
	})
})
