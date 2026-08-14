import { describe, expect, it } from 'vitest'
import {
	ORG_ID_STORAGE_KEY,
	readOrgHandleFromSearch,
	resolveOrgId,
} from '../../../organizer/services/org-handle'
import { createMockLocalStorage } from '../../helpers/mock-local-storage'

describe('readOrgHandleFromSearch', () => {
	it('reads the canonical org_id param', () => {
		expect(readOrgHandleFromSearch('?org_id=org-123')).toBe('org-123')
	})

	it('reads the org alias param', () => {
		expect(readOrgHandleFromSearch('?org=org-456')).toBe('org-456')
	})

	it('prefers org_id over the org alias when both are present', () => {
		expect(readOrgHandleFromSearch('?org=alias&org_id=canonical')).toBe(
			'canonical',
		)
	})

	it('trims surrounding whitespace', () => {
		expect(readOrgHandleFromSearch('?org_id=%20org-7%20')).toBe('org-7')
	})

	it('returns null when no handle param is present', () => {
		expect(readOrgHandleFromSearch('?foo=bar')).toBeNull()
	})

	it('returns null for an empty query string', () => {
		expect(readOrgHandleFromSearch('')).toBeNull()
	})

	it('treats a blank value as absent', () => {
		expect(readOrgHandleFromSearch('?org_id=%20%20')).toBeNull()
	})
})

describe('resolveOrgId', () => {
	it('returns the URL handle and remembers it', () => {
		const storage = createMockLocalStorage()
		const result = resolveOrgId('?org_id=org-abc', storage)

		expect(result).toBe('org-abc')
		expect(storage.setItem).toHaveBeenCalledWith(ORG_ID_STORAGE_KEY, 'org-abc')
	})

	it('falls back to the remembered id when no URL handle is present', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-remembered',
		})
		const result = resolveOrgId('', storage)

		expect(result).toBe('org-remembered')
		// Nothing new to persist when reading from storage.
		expect(storage.setItem).not.toHaveBeenCalled()
	})

	it('prefers the URL handle over a remembered id and overwrites it', () => {
		const storage = createMockLocalStorage({
			[ORG_ID_STORAGE_KEY]: 'org-old',
		})
		const result = resolveOrgId('?org_id=org-new', storage)

		expect(result).toBe('org-new')
		expect(storage.setItem).toHaveBeenCalledWith(ORG_ID_STORAGE_KEY, 'org-new')
	})

	it('returns null when neither a URL handle nor a remembered id exists', () => {
		const storage = createMockLocalStorage()
		expect(resolveOrgId('', storage)).toBeNull()
	})

	it('degrades to no-pin when reading storage throws', () => {
		const storage = {
			getItem: () => {
				throw new Error('storage disabled')
			},
			setItem: () => {},
		}
		expect(resolveOrgId('', storage)).toBeNull()
	})

	it('still returns the URL handle when persisting it throws', () => {
		const storage = {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded')
			},
		}
		expect(resolveOrgId('?org_id=org-xyz', storage)).toBe('org-xyz')
	})
})
