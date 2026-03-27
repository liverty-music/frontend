import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mockCurrentPath = ''

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn(() => ({
			routeTree: {
				root: {
					children: [
						{
							computeAbsolutePath: () => mockCurrentPath,
						},
					],
				},
			},
		})),
	}
})

import { BottomNavBar } from './bottom-nav-bar'

describe('BottomNavBar', () => {
	let sut: BottomNavBar

	beforeEach(() => {
		mockCurrentPath = ''
		sut = new BottomNavBar()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('tabs', () => {
		it('has 5 navigation tabs', () => {
			expect(sut.tabs).toHaveLength(5)
		})

		it('includes dashboard, discovery, my-artists, tickets, settings', () => {
			const paths = sut.tabs.map((t) => t.path)
			expect(paths).toEqual([
				'dashboard',
				'discovery',
				'my-artists',
				'tickets',
				'settings',
			])
		})
	})

	describe('isActive', () => {
		it('returns true for exact path match', () => {
			mockCurrentPath = 'dashboard'

			expect(sut.isActive('dashboard')).toBe(true)
		})

		it('returns false for non-matching path', () => {
			mockCurrentPath = 'settings'

			expect(sut.isActive('dashboard')).toBe(false)
		})

		it('dashboard matches concerts/ sub-path', () => {
			mockCurrentPath = 'concerts/abc-123'

			expect(sut.isActive('dashboard')).toBe(true)
		})

		it('matches sub-paths for other tabs', () => {
			mockCurrentPath = 'my-artists/detail'

			expect(sut.isActive('my-artists')).toBe(true)
		})

		it('returns false when currentPath is empty', () => {
			mockCurrentPath = ''

			expect(sut.isActive('dashboard')).toBe(false)
		})
	})
})
