import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearVerifySessionId,
	loadVerifySessionId,
	saveVerifySessionId,
} from './verify-session-storage'

// ── localStorage isolation ─────────────────────────────────────────────────────
//
// vitest runs under jsdom (see vitest.config.ts), which provides a real
// localStorage implementation. We clear it around each test and restore any
// spies so tests stay independent.

beforeEach(() => {
	localStorage.clear()
	vi.restoreAllMocks()
})

afterEach(() => {
	localStorage.clear()
	vi.restoreAllMocks()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('verify-session-storage', () => {
	describe('save → load round-trip', () => {
		it('loadVerifySessionId returns the value written by saveVerifySessionId', () => {
			saveVerifySessionId('sess-round-trip')

			expect(loadVerifySessionId()).toBe('sess-round-trip')
		})

		it('all three functions use the SAME localStorage key (round-trip proves it)', () => {
			// Write via save, read via load — if the keys differed, load would return null.
			saveVerifySessionId('sess-key-consistency')
			expect(loadVerifySessionId()).toBe('sess-key-consistency')

			// Clear via clear, then load — if the clear key differed, load would still return the value.
			clearVerifySessionId()
			expect(loadVerifySessionId()).toBeNull()
		})

		it('clear → load returns null', () => {
			saveVerifySessionId('sess-before-clear')
			clearVerifySessionId()

			expect(loadVerifySessionId()).toBeNull()
		})
	})

	describe('saveVerifySessionId', () => {
		it('returns true on a successful write', () => {
			const result = saveVerifySessionId('sess-ok')

			expect(result).toBe(true)
		})

		it('returns false (does not throw) when localStorage.setItem throws a SecurityError (private-mode Safari / sandboxed iframe)', () => {
			const securityError = new DOMException(
				'The operation is insecure.',
				'SecurityError',
			)
			vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
				throw securityError
			})

			// Must not throw — the storage failure is a non-fatal, expected condition.
			const result = saveVerifySessionId('sess-sandboxed')

			expect(result).toBe(false)
		})
	})

	describe('loadVerifySessionId', () => {
		it('returns null when no value has been saved', () => {
			expect(loadVerifySessionId()).toBeNull()
		})

		it('returns null (does not throw) when localStorage.getItem throws', () => {
			vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
				throw new DOMException('The operation is insecure.', 'SecurityError')
			})

			// Must not throw.
			expect(loadVerifySessionId()).toBeNull()
		})
	})
})
