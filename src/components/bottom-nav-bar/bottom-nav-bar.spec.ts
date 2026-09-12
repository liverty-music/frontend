import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// BottomNavBar resolves IPageHeaderState in its class body (its `activePath` is
// read by the template, not by `isActive`). Stub `resolve` so `new BottomNavBar()`
// works without a DI container; `isActive` itself is a pure function of its args.
vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => ({ activePath: '' })),
	}
})

import { BottomNavBar } from './bottom-nav-bar'

describe('BottomNavBar', () => {
	let sut: BottomNavBar

	beforeEach(() => {
		sut = new BottomNavBar()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('tabs', () => {
		it('has 4 navigation tabs', () => {
			expect(sut.tabs).toHaveLength(4)
		})

		it('includes dashboard, discovery, my-artists, settings', () => {
			const paths = sut.tabs.map((t) => t.path)
			expect(paths).toEqual([
				'dashboard',
				'discovery',
				'my-artists',
				'settings',
			])
		})
	})

	// `isActive(path, activePath)` is a pure comparison of the tab path against the
	// shared state's `activePath` (with the existing sub-path highlight rules).
	describe('isActive', () => {
		it('is true for the exact-matching tab path', () => {
			expect(sut.isActive('dashboard', 'dashboard')).toBe(true)
		})

		it('is false for a non-matching tab path', () => {
			expect(sut.isActive('settings', 'dashboard')).toBe(false)
		})

		it('highlights dashboard for a concerts/ sub-path', () => {
			expect(sut.isActive('dashboard', 'concerts/abc-123')).toBe(true)
		})

		it('highlights the owning tab for a sub-path', () => {
			expect(sut.isActive('my-artists', 'my-artists/detail')).toBe(true)
		})

		it('is false for every tab when no path is active', () => {
			expect(sut.tabs.every((t) => !sut.isActive(t.path, ''))).toBe(true)
		})

		it('reflects a change of the active path', () => {
			expect(sut.isActive('dashboard', 'dashboard')).toBe(true)
			expect(sut.isActive('dashboard', 'discovery')).toBe(false)
			expect(sut.isActive('discovery', 'discovery')).toBe(true)
		})
	})
})
