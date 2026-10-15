import { describe, expect, it } from 'vitest'
import {
	applyOrgPin,
	ORG_ID_STORAGE_KEY,
	ORG_SHORT_NAME_STORAGE_KEY,
	primaryDomainOf,
	readOrgPinFromSearch,
	resolveOrgPin,
} from '../../../organizer/services/org-handle'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockLocalStorage } from '../../helpers/mock-local-storage'

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
	// @spec stories/sign-in-as-organizer "Invited operator lands on the console after accepting the invite"
	it('returns an id from the address and remembers it', () => {
		const storage = createMockLocalStorage({
			[ORG_SHORT_NAME_STORAGE_KEY]: 'old-label',
		})
		const result = resolveOrgPin('?org_id=org-abc', storage)

		expect(result).toEqual({ kind: 'id', orgId: 'org-abc' })
		expect(storage.setItem).toHaveBeenCalledWith(ORG_ID_STORAGE_KEY, 'org-abc')
		expect(storage.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
	})

	// @spec components/infrastructure/organizer/web/route/find-organizer "Link opened"
	it('remembers the Organizer of an opened sign-in link for the next visit', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-old',
		})

		// The link from the email: /?org=<short name>.
		const opened = resolveOrgPin('?org=xx-records', storage)
		// The next visit on the device, without the link.
		const next = resolveOrgPin('', storage)

		const pin = { kind: 'shortName', shortName: 'xx-records' }
		expect(opened).toEqual(pin)
		expect(next).toEqual(pin)
		expect(storage.getItem(ORG_ID_STORAGE_KEY)).toBeNull()
	})

	it('falls back to the pin remembered on the device', () => {
		expect(
			resolveOrgPin(
				'',
				createMockLocalStorage({ [ORG_ID_STORAGE_KEY]: 'org-remembered' }),
			),
		).toEqual({ kind: 'id', orgId: 'org-remembered' })
		expect(
			resolveOrgPin(
				'',
				createMockLocalStorage({ [ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records' }),
			),
		).toEqual({ kind: 'shortName', shortName: 'xx-records' })
	})

	it('does not persist anything when reading from storage', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-remembered',
		})
		resolveOrgPin('', storage)
		expect(storage.setItem).not.toHaveBeenCalled()
	})

	it('prefers the address over a remembered pin and overwrites it', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-old',
		})
		expect(resolveOrgPin('?org_id=org-new', storage)).toEqual({
			kind: 'id',
			orgId: 'org-new',
		})
		expect(storage.setItem).toHaveBeenCalledWith(ORG_ID_STORAGE_KEY, 'org-new')
	})

	it('returns null on a device that remembers nothing and an address that names nothing', () => {
		expect(resolveOrgPin('', createMockLocalStorage())).toBeNull()
	})

	it('degrades to no pin when reading storage throws', () => {
		const storage = {
			getItem: () => {
				throw new Error('storage disabled')
			},
			setItem: () => {},
			removeItem: () => {},
		}
		expect(resolveOrgPin('', storage)).toBeNull()
	})

	it('still returns the pin from the address when persisting it throws', () => {
		const storage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded')
			},
			removeItem: () => {},
		}
		expect(resolveOrgPin('?org=xx-records', storage)).toEqual({
			kind: 'shortName',
			shortName: 'xx-records',
		})
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
