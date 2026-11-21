import { describe, expect, it } from 'vitest'
import {
	applyOrgPin,
	ORG_ID_STORAGE_KEY,
	ORG_SHORT_NAME_STORAGE_KEY,
	type OrgPin,
	PENDING_ORG_PIN_STORAGE_KEY,
	primaryDomainOf,
	readOrgPinFromSearch,
	rememberOrgPin,
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
	// The invite's default redirect returns to /?org_id=<id>; the console pins
	// sign-in to that Organization's login policy.
	// @spec stories/sign-in-as-organizer "Invited owner lands on the console after accepting the invite"
	it('returns an id from the address and keeps it for the callback, not as remembered', () => {
		const storage = createMockLocalStorage({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'old-label',
		})
		const result = resolveOrgPin('?org_id=org-abc', storage, '/')

		expect(result).toEqual({ kind: 'id', orgId: 'org-abc' })
		expect(storage.getItem(ORG_ID_STORAGE_KEY)).toBeNull()
		expect(storage.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBe('old-label')
		// The callback of the sign-in it starts names the same Organization.
		expect(resolveOrgPin('', storage, CALLBACK)).toEqual(result)
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Link opened"
	it('remembers the Organizer of an opened sign-in link once the sign-in admits the member', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-old',
		})

		// The link from the email: /?org=<short name>.
		const opened = resolveOrgPin('?org=xx-records', storage, '/')
		// The sign-in returns to the callback, and the guard admits the member.
		const atCallback = resolveOrgPin('', storage, CALLBACK)
		rememberOrgPin(storage, atCallback as OrgPin)
		// The next visit on the device, without the link.
		const next = resolveOrgPin('', storage, '/')

		const pin = { kind: 'shortName', shortName: 'xx-records' }
		expect(opened).toEqual(pin)
		expect(atCallback).toEqual(pin)
		expect(next).toEqual(pin)
		expect(storage.getItem(ORG_ID_STORAGE_KEY)).toBeNull()
		expect(storage.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	// liverty-music/frontend#1076: a link to an Organizer that does not exist
	// (or was deactivated) fails at sign-in. It must not stick to the device.
	it('does not remember a pin from the address that no sign-in admitted', () => {
		const storage = createMockLocalStorage()

		resolveOrgPin('?org=gone-records', storage, '/')
		// The sign-in failed; the next visit opens the console without the link.
		const next = resolveOrgPin('', storage, '/')

		expect(next).toBeNull()
		expect(storage.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		expect(storage.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	it('keeps the remembered pin when a link to another Organizer fails at sign-in', () => {
		const storage = createMockLocalStorage({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records',
		})

		expect(resolveOrgPin('?org=gone-records', storage, '/')).toEqual({
			kind: 'shortName',
			shortName: 'gone-records',
		})
		expect(resolveOrgPin('', storage, '/')).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
		// A later sign-in started from the remembered pin returns to a callback
		// that names the remembered Organization, not the failed one.
		expect(resolveOrgPin('', storage, CALLBACK)).toEqual({
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
			),
		).toEqual({ kind: 'id', orgId: 'org-remembered' })
		expect(
			resolveOrgPin(
				'',
				createMockLocalStorage({ [ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records' }),
				CALLBACK,
			),
		).toEqual({ kind: 'shortName', shortName: 'xx-records' })
	})

	it('does not persist anything when reading from storage', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-remembered',
		})
		resolveOrgPin('', storage, '/')
		expect(storage.setItem).not.toHaveBeenCalled()
	})

	it('prefers the address over a remembered pin without overwriting it', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-old',
		})
		expect(resolveOrgPin('?org_id=org-new', storage, '/')).toEqual({
			kind: 'id',
			orgId: 'org-new',
		})
		expect(storage.getItem(ORG_ID_STORAGE_KEY)).toBe('org-old')
	})

	it('returns null on a device that remembers nothing and an address that names nothing', () => {
		expect(resolveOrgPin('', createMockLocalStorage(), '/')).toBeNull()
		expect(resolveOrgPin('', createMockLocalStorage(), CALLBACK)).toBeNull()
	})

	it('ignores a malformed pending pin at the callback', () => {
		const storage = createMockLocalStorage({
			[PENDING_ORG_PIN_STORAGE_KEY]: '{not json',
			[ORG_ID_STORAGE_KEY]: 'org-remembered',
		})
		expect(resolveOrgPin('', storage, CALLBACK)).toEqual({
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
		expect(resolveOrgPin('', storage, '/')).toBeNull()
		expect(resolveOrgPin('', storage, CALLBACK)).toBeNull()
	})

	it('still returns the pin from the address when persisting it throws', () => {
		const storage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded')
			},
			removeItem: () => {},
		}
		expect(resolveOrgPin('?org=xx-records', storage, '/')).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
	})
})

describe('rememberOrgPin', () => {
	it('replaces a remembered pin of the other kind and ends the pending sign-in', () => {
		const storage = createMockLocalStorage({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'old-label',
			[PENDING_ORG_PIN_STORAGE_KEY]: '{"orgId":"org-new"}',
		})

		rememberOrgPin(storage, { kind: 'id', orgId: 'org-new' })

		expect(storage.getItem(ORG_ID_STORAGE_KEY)).toBe('org-new')
		expect(storage.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		expect(storage.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
	})

	it('writes nothing when the pin is already remembered and nothing is pending', () => {
		const storage = createMockLocalStorage({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records',
		})

		rememberOrgPin(storage, { kind: 'shortName', shortName: 'xx-records' })

		expect(storage.setItem).not.toHaveBeenCalled()
		expect(storage.removeItem).not.toHaveBeenCalled()
	})

	it('does not throw when the store is unavailable', () => {
		const storage = {
			getItem: () => {
				throw new Error('storage disabled')
			},
			setItem: () => {
				throw new Error('storage disabled')
			},
			removeItem: () => {},
		}
		expect(() =>
			rememberOrgPin(storage, { kind: 'id', orgId: 'org-1' }),
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
