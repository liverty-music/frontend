import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateStorageKeys, StorageKeys } from './storage-keys'

const LEGACY_GUEST_LANGUAGE = 'guest.language'

describe('migrateStorageKeys — legacy guest.language migration', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		localStorage.clear()
	})

	it('promotes the explicit guest choice when it differs from the detector cache', () => {
		// Explicit guest choice (ja) outranks the auto-detected detector cache (en).
		localStorage.setItem(LEGACY_GUEST_LANGUAGE, 'ja')
		localStorage.setItem(StorageKeys.language, 'en')

		migrateStorageKeys()

		expect(localStorage.getItem(StorageKeys.language)).toBe('ja')
		expect(localStorage.getItem(LEGACY_GUEST_LANGUAGE)).toBeNull()
	})

	it('promotes the explicit guest choice when the detector cache is absent', () => {
		// An absent `language` (e.g. cleared by a prior authenticated session) still
		// differs from a present `guest.language`, so the explicit choice is promoted.
		localStorage.setItem(LEGACY_GUEST_LANGUAGE, 'ja')

		migrateStorageKeys()

		expect(localStorage.getItem(StorageKeys.language)).toBe('ja')
		expect(localStorage.getItem(LEGACY_GUEST_LANGUAGE)).toBeNull()
	})

	it('removes the legacy key without rewriting when the values already match', () => {
		localStorage.setItem(LEGACY_GUEST_LANGUAGE, 'ja')
		localStorage.setItem(StorageKeys.language, 'ja')

		migrateStorageKeys()

		expect(localStorage.getItem(StorageKeys.language)).toBe('ja')
		expect(localStorage.getItem(LEGACY_GUEST_LANGUAGE)).toBeNull()
	})

	it('is a no-op for the language keys when no legacy key is present', () => {
		localStorage.setItem(StorageKeys.language, 'en')

		migrateStorageKeys()

		expect(localStorage.getItem(StorageKeys.language)).toBe('en')
		expect(localStorage.getItem(LEGACY_GUEST_LANGUAGE)).toBeNull()
	})

	it('is idempotent across repeated startups', () => {
		localStorage.setItem(LEGACY_GUEST_LANGUAGE, 'ja')
		localStorage.setItem(StorageKeys.language, 'en')

		migrateStorageKeys()
		migrateStorageKeys()

		expect(localStorage.getItem(StorageKeys.language)).toBe('ja')
		expect(localStorage.getItem(LEGACY_GUEST_LANGUAGE)).toBeNull()
	})
})
